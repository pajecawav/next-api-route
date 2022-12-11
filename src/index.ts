import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import type { ZodIssue, ZodSchema } from "zod";
import { z } from "zod";

const allowedMethods = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "TRACE"] as const;

export type RequestMethod = typeof allowedMethods[number];

// query is always an object
type QueryBase = Record<string, any> & {};

export type RouteParams<TResponse, TBody, TQuery extends QueryBase> = {
	req: NextApiRequest;
	res: NextApiResponse<TResponse>;
	body: TBody;
	query: TQuery;
};

export type ErrorResponse = { errors: ZodIssue[] };

export type Handler<TResponse, TBody, TQuery extends QueryBase> = (
	params: RouteParams<TResponse, TBody, TQuery>
) => void | TResponse | Promise<TResponse>;

const anySchema = z.any();

export type RouteInit<TBody, TQuery> = {
	middlewares?: Middleware[];
	bodySchema?: ZodSchema<TBody>;
	querySchema?: ZodSchema<TQuery>;
};

export class Route<TResponse, TBody, TQuery extends QueryBase> {
	private middlewares: Middleware[];
	private bodySchema: ZodSchema<TBody>;
	private querySchema: ZodSchema<TQuery>;

	constructor(
		private handler: Handler<TResponse, TBody, TQuery>,
		{ middlewares, bodySchema, querySchema }: RouteInit<TBody, TQuery>
	) {
		this.middlewares = middlewares ?? [];
		this.bodySchema = bodySchema ?? anySchema;
		this.querySchema = querySchema ?? anySchema;
	}

	private async execute(req: NextApiRequest, res: NextApiResponse<TResponse | ErrorResponse>) {
		let body: TBody;
		const bodyResult = await this.bodySchema.safeParseAsync(req.body);
		if (bodyResult.success) {
			body = bodyResult.data;
		} else {
			// TODO: better error handling
			res.status(400).json({ errors: bodyResult.error.issues });
			return;
		}

		let query: TQuery;
		const queryResult = await this.querySchema.safeParseAsync(req.query);
		if (queryResult.success) {
			query = queryResult.data;
		} else {
			// TODO: better error handling
			res.status(400).json({ errors: queryResult.error.issues });
			return;
		}

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

	async handle(req: NextApiRequest, res: NextApiResponse<TResponse | ErrorResponse>) {
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

export type RouteBuilderInit<TBody, TQuery extends QueryBase> = {
	middlewares?: Middleware[];
	bodySchema?: ZodSchema<TBody>;
	querySchema?: ZodSchema<TQuery>;
};

export class RouterBuilder<TBody, TQuery extends QueryBase> {
	private middlewares: Middleware[];
	private bodySchema?: ZodSchema<TBody>;
	private querySchema?: ZodSchema<TQuery>;

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

	body<B>(schema: ZodSchema<B>): RouterBuilder<B, TQuery> {
		return new RouterBuilder({
			middlewares: this.middlewares,
			bodySchema: schema,
			querySchema: this.querySchema,
		});
	}

	query<Q extends QueryBase>(schema: ZodSchema<Q>): RouterBuilder<TBody, Q> {
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
