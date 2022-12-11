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
	bodySchema?: ZodSchema<TBody>;
	querySchema?: ZodSchema<TQuery>;
};

export class Route<TResponse, TBody, TQuery extends QueryBase> {
	private bodySchema: ZodSchema<TBody>;
	private querySchema: ZodSchema<TQuery>;

	constructor(
		private handler: Handler<TResponse, TBody, TQuery>,
		{ bodySchema, querySchema }: RouteInit<TBody, TQuery>
	) {
		this.bodySchema = bodySchema ?? anySchema;
		this.querySchema = querySchema ?? anySchema;
	}

	async handle(req: NextApiRequest, res: NextApiResponse<TResponse | ErrorResponse>) {
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
			res.json(result);
		}
	}
}

export type RouteBuilderInit<TBody, TQuery extends QueryBase> = {
	bodySchema?: ZodSchema<TBody>;
	querySchema?: ZodSchema<TQuery>;
};

export class RouterBuilder<TBody, TQuery extends QueryBase> {
	private bodySchema?: ZodSchema<TBody>;
	private querySchema?: ZodSchema<TQuery>;

	constructor({ bodySchema, querySchema }: RouteBuilderInit<TBody, TQuery> = {}) {
		this.bodySchema = bodySchema;
		this.querySchema = querySchema;
	}

	body<B>(schema: ZodSchema<B>): RouterBuilder<B, TQuery> {
		return new RouterBuilder({ bodySchema: schema, querySchema: this.querySchema });
	}

	query<Q extends QueryBase>(schema: ZodSchema<Q>): RouterBuilder<TBody, Q> {
		return new RouterBuilder({ bodySchema: this.bodySchema, querySchema: schema });
	}

	build<TResponse = any>(
		handler: Handler<TResponse, TBody, TQuery>
	): Route<TResponse, TBody, TQuery> {
		return new Route(handler, { bodySchema: this.bodySchema, querySchema: this.querySchema });
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
