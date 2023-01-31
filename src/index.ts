import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import type { SafeParseReturnType, ZodIssue } from "zod";

const allowedMethods = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "TRACE"] as const;

export type RequestMethod = (typeof allowedMethods)[number];

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

export type RouteHandler<TResponse, TBody, TQuery extends QueryBase> = (
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
	private handler: RouteHandler<TResponse, TBody, TQuery>;
	private middlewares: Middleware[];
	private bodySchema: ZodSchemaLike<TBody>;
	private querySchema: ZodSchemaLike<TQuery>;

	constructor(
		handler: RouteHandler<TResponse, TBody, TQuery>,
		{ middlewares, bodySchema, querySchema }: RouteInit<TBody, TQuery>
	) {
		this.handler = handler;
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

		await next();
	}
}

export type Middleware = (
	req: NextApiRequest,
	res: NextApiResponse,
	next: () => Promise<void>
) => void;

export function handleValidationError(
	error: ValidationError,
	req: NextApiRequest,
	res: NextApiResponse<ValidationErrorResponse>
) {
	res.status(400).json({ message: error.message, errors: error.errors });
}

export type RouteBuilderInit<TBody, TQuery extends QueryBase> = {
	middlewares?: Middleware[];
	bodySchema?: ZodSchemaLike<TBody>;
	querySchema?: ZodSchemaLike<TQuery>;
};

export class RouteBuilder<TBody, TQuery extends QueryBase> {
	private middlewares: Middleware[];
	private bodySchema?: ZodSchemaLike<TBody>;
	private querySchema?: ZodSchemaLike<TQuery>;

	constructor({ bodySchema, querySchema, middlewares }: RouteBuilderInit<TBody, TQuery> = {}) {
		this.middlewares = middlewares ?? [];
		this.bodySchema = bodySchema;
		this.querySchema = querySchema;
	}

	use<M>(middleware: Middleware): RouteBuilder<TBody, TQuery> {
		const middlewares = [...this.middlewares, middleware];
		return new RouteBuilder({
			middlewares,
			bodySchema: this.bodySchema,
			querySchema: this.querySchema,
		});
	}

	body<B>(schema: ZodSchemaLike<B>): RouteBuilder<B, TQuery> {
		return new RouteBuilder({
			middlewares: this.middlewares,
			bodySchema: schema,
			querySchema: this.querySchema,
		});
	}

	query<Q extends QueryBase>(schema: ZodSchemaLike<Q>): RouteBuilder<TBody, Q> {
		return new RouteBuilder({
			middlewares: this.middlewares,
			bodySchema: this.bodySchema,
			querySchema: schema,
		});
	}

	build<TResponse = any>(
		handler: RouteHandler<TResponse, TBody, TQuery>
	): Route<TResponse, TBody, TQuery> {
		return new Route(handler, {
			middlewares: this.middlewares,
			bodySchema: this.bodySchema,
			querySchema: this.querySchema,
		});
	}
}

export function route(): RouteBuilder<any, QueryBase> {
	return new RouteBuilder();
}

type RouteFn = typeof route;

type RoutesMap = Partial<Record<RequestMethod, Route<any, any, any>>>;

export function defaultOnError(
	error: unknown,
	req: NextApiRequest,
	res: NextApiResponse<ValidationErrorResponse | string>
) {
	if (error instanceof ValidationError) {
		handleValidationError(error, req, res);
		return;
	}

	res.status(500).send("Internal Server Error");
}

export function defaultOnNotAllowed(
	method: RequestMethod,
	req: NextApiRequest,
	res: NextApiResponse
) {
	res.status(405).send("Method Not Allowed");
}

export interface RouterHandler<Routes extends RoutesMap> extends NextApiHandler {}

export type RouteData<TResponse, TBody, TQuery> = {
	response: TResponse;
	body: TBody;
	query: TQuery;
};

export type RouterData<Routes extends RoutesMap> = {
	[Key in keyof Routes]: Routes[Key] extends Route<infer TResponse, infer TBody, infer TQuery>
		? RouteData<TResponse, TBody, TQuery>
		: never;
};

export type InferRouter<R extends RouterHandler<any>> = R extends RouterHandler<infer Routes>
	? RouterData<Routes>
	: never;

export type RouterOptions = {
	onError?: (error: unknown, req: NextApiRequest, res: NextApiResponse) => void;
	onNotAllowed?: (method: RequestMethod, req: NextApiRequest, res: NextApiResponse) => void;
};

export function createRouter<Routes extends RoutesMap>(
	routes: (route: RouteFn) => Routes,
	options?: RouterOptions
): RouterHandler<Routes>;
export function createRouter<Routes extends RoutesMap>(
	routes: Routes,
	options?: RouterOptions
): RouterHandler<Routes>;
export function createRouter<Routes extends RoutesMap>(
	routes: Routes | ((route: RouteFn) => Routes),
	options?: RouterOptions
): RouterHandler<Routes> {
	const routesMap = typeof routes === "function" ? routes(route) : routes;
	const { onError = defaultOnError, onNotAllowed = defaultOnNotAllowed } = options ?? {};

	for (const method of Object.keys(routes)) {
		if (!allowedMethods.includes(method as any)) {
			throw new Error(`Unsupported method ${method}`);
		}
	}

	const fn: RouterHandler<Routes> = async (req: NextApiRequest, res: NextApiResponse) => {
		const method = req.method as RequestMethod;
		const handler = routesMap[method];

		if (!handler) {
			onNotAllowed(method, req, res);
			return;
		}

		try {
			await handler.handle(req, res);
		} catch (e) {
			onError(e, req, res);
		}
	};

	return fn;
}
