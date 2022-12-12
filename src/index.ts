import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import type { SafeParseReturnType, ZodIssue } from "zod";

const allowedMethods = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "TRACE"] as const;

export type RequestMethod = typeof allowedMethods[number];

export class ValidationError extends Error {
	errors: ZodIssue[];

	constructor({ message, errors }: { message: string; errors: ZodIssue[] }) {
		super(message);
		this.errors = errors;
	}
}

export type ZodSchemaLike<T> = {
	// we have to use async parsing to support async refinements and transforms
	// (https://github.com/colinhacks/zod#parseasync)
	safeParseAsync(obj: unknown): Promise<SafeParseReturnType<T, T>>;
};

// query is always an object
type QueryBase = Record<string, any> & {};

export type RouteParams<TResponse, TBody, TQuery extends QueryBase> = {
	req: NextApiRequest;
	res: NextApiResponse<TResponse>;
	body: TBody;
	query: TQuery;
};

export type ValidationErrorResponse = { message: string; errors: ZodIssue[] };

export type Handler<TResponse, TBody, TQuery extends QueryBase> = (
	params: RouteParams<TResponse, TBody, TQuery>
) => void | TResponse | Promise<TResponse>;

const anySchema: ZodSchemaLike<any> = {
	async safeParseAsync(data) {
		return { success: true, data };
	},
};

export type RouteInit<TBody, TQuery> = {
	middlewares?: Middleware[];
	bodySchema?: ZodSchemaLike<TBody>;
	querySchema?: ZodSchemaLike<TQuery>;
};

export class Route<TResponse, TBody, TQuery extends QueryBase> {
	private middlewares: Middleware[];
	private bodySchema: ZodSchemaLike<TBody>;
	private querySchema: ZodSchemaLike<TQuery>;

	constructor(
		private handler: Handler<TResponse, TBody, TQuery>,
		{ middlewares, bodySchema, querySchema }: RouteInit<TBody, TQuery>
	) {
		this.middlewares = middlewares ?? [];
		this.bodySchema = bodySchema ?? anySchema;
		this.querySchema = querySchema ?? anySchema;
	}

	private async execute(
		req: NextApiRequest,
		res: NextApiResponse<TResponse | ValidationErrorResponse>
	) {
		const parsedBody = await this.bodySchema.safeParseAsync(req.body);
		if (!parsedBody.success) {
			throw new ValidationError({
				message: "Failed to parse body",
				errors: parsedBody.error.errors,
			});
		}
		const body: TBody = parsedBody.data;

		const parsedQuery = await this.querySchema.safeParseAsync(req.query);
		if (!parsedQuery.success) {
			throw new ValidationError({
				message: "Failed to parse query",
				errors: parsedQuery.error.errors,
			});
		}
		const query: TQuery = parsedQuery.data;

		const params: RouteParams<TResponse, TBody, TQuery> = {
			req,
			res,
			body,
			query,
		};

		const result = await this.handler(params);
		if (typeof result !== "undefined") {
			res.status(res.statusCode || 200);
			// TODO: should string be sent via `res.send`?
			res.json(result);
		}
	}

	async handle(req: NextApiRequest, res: NextApiResponse<TResponse | ValidationErrorResponse>) {
		const fns = [...this.middlewares, () => this.execute(req, res)];

		let index = 0;
		const next = async () => {
			// TODO: check if current middleware was called before to prevent
			// multiple executions of `next`
			const fn = fns[index++];
			if (!fn) return;
			await fn(req, res, next);
		};

		try {
			await next();
		} catch (e: unknown) {
			if (e instanceof ValidationError) {
				res.status(400).json({ message: e.message, errors: e.errors });
				return;
			}

			throw e;
		}
	}
}

export type Middleware = (
	req: NextApiRequest,
	res: NextApiResponse,
	next: () => Promise<void>
) => void;

export type RouteBuilderInit<TBody, TQuery extends QueryBase> = {
	middlewares?: Middleware[];
	bodySchema?: ZodSchemaLike<TBody>;
	querySchema?: ZodSchemaLike<TQuery>;
};

export class RouterBuilder<TBody, TQuery extends QueryBase> {
	private middlewares: Middleware[];
	private bodySchema?: ZodSchemaLike<TBody>;
	private querySchema?: ZodSchemaLike<TQuery>;

	constructor({ bodySchema, querySchema, middlewares }: RouteBuilderInit<TBody, TQuery> = {}) {
		this.middlewares = middlewares ?? [];
		this.bodySchema = bodySchema;
		this.querySchema = querySchema;
	}

	use<M>(middleware: Middleware): RouterBuilder<TBody, TQuery> {
		const middlewares = [...this.middlewares, middleware];
		return new RouterBuilder({
			middlewares,
			bodySchema: this.bodySchema,
			querySchema: this.querySchema,
		});
	}

	body<B>(schema: ZodSchemaLike<B>): RouterBuilder<B, TQuery> {
		return new RouterBuilder({
			middlewares: this.middlewares,
			bodySchema: schema,
			querySchema: this.querySchema,
		});
	}

	query<Q extends QueryBase>(schema: ZodSchemaLike<Q>): RouterBuilder<TBody, Q> {
		return new RouterBuilder({
			middlewares: this.middlewares,
			bodySchema: this.bodySchema,
			querySchema: schema,
		});
	}

	build<TResponse = any>(
		handler: Handler<TResponse, TBody, TQuery>
	): Route<TResponse, TBody, TQuery> {
		return new Route(handler, {
			middlewares: this.middlewares,
			bodySchema: this.bodySchema,
			querySchema: this.querySchema,
		});
	}
}

export function route(): RouterBuilder<any, QueryBase> {
	return new RouterBuilder();
}

type RouteFn = typeof route;

type RoutesMap = Partial<Record<RequestMethod, Route<any, any, any>>>;

export function createRouter(routes: (route: RouteFn) => RoutesMap): NextApiHandler;
export function createRouter(routes: RoutesMap): NextApiHandler;
export function createRouter(routes: RoutesMap | ((route: RouteFn) => RoutesMap)): NextApiHandler {
	const routesMap = typeof routes === "function" ? routes(route) : routes;

	for (const method of Object.keys(routes)) {
		if (!allowedMethods.includes(method as any)) {
			throw new Error(`Unsupported method ${method}`);
		}
	}

	return async (req: NextApiRequest, res: NextApiResponse) => {
		const handler = routesMap[req.method as RequestMethod];

		if (!handler) {
			res.status(405).send("Method Not Allowed");
			return;
		}

		try {
			await handler.handle(req, res);
		} catch (e) {
			// TODO: proper error handling
			res.status(500).send("Internal server error");
		}
	};
}
