import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import type { ZodIssue, ZodSchema } from "zod";
import { z } from "zod";

const allowedMethods = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const;

export type RequestMethod = typeof allowedMethods[number];

// query is always an object
type QueryBase = Record<string, any> & {};

export type RouteParams<Response, Body, Query extends QueryBase> = {
	req: NextApiRequest;
	res: NextApiResponse<Response>;
	body: Body;
	query: Query;
};

export type ErrorResponse = { errors: ZodIssue[] };

export type Handler<Response, Body, Query extends QueryBase> = (
	params: RouteParams<Response, Body, Query>
) => void;

const anySchema = z.any();

export type RouteInit<Body, Query> = {
	bodySchema?: ZodSchema<Body>;
	querySchema?: ZodSchema<Query>;
};

export class Route<Response, Body, Query extends QueryBase> {
	private bodySchema: ZodSchema<Body>;
	private querySchema: ZodSchema<Query>;

	constructor(
		private handler: Handler<Response, Body, Query>,
		{ bodySchema, querySchema }: RouteInit<Body, Query>
	) {
		this.bodySchema = bodySchema ?? anySchema;
		this.querySchema = querySchema ?? anySchema;
	}

	async handle(req: NextApiRequest, res: NextApiResponse<Response | ErrorResponse>) {
		let body: Body;
		const bodyResult = await this.bodySchema.safeParseAsync(req.body);
		if (bodyResult.success) {
			body = bodyResult.data;
		} else {
			// TODO: better error handling
			res.status(400).json({ errors: bodyResult.error.issues });
			return;
		}

		let query: Query;
		const queryResult = await this.querySchema.safeParseAsync(req.query);
		if (queryResult.success) {
			query = queryResult.data;
		} else {
			// TODO: better error handling
			res.status(400).json({ errors: queryResult.error.issues });
			return;
		}

		const params: RouteParams<Response, Body, Query> = {
			req,
			res,
			body,
			query,
		};

		this.handler(params);
	}
}

export type RouteBuilderInit<Body, Query extends QueryBase> = {
	bodySchema?: ZodSchema<Body>;
	querySchema?: ZodSchema<Query>;
};

export class RouterBuilder<Body, Query extends QueryBase> {
	private bodySchema?: ZodSchema<Body>;
	private querySchema?: ZodSchema<Query>;

	constructor({ bodySchema, querySchema }: RouteBuilderInit<Body, Query> = {}) {
		this.bodySchema = bodySchema;
		this.querySchema = querySchema;
	}

	body<B>(schema: ZodSchema<B>): RouterBuilder<B, Query> {
		return new RouterBuilder({ bodySchema: schema, querySchema: this.querySchema });
	}

	query<Q extends QueryBase>(schema: ZodSchema<Q>): RouterBuilder<Body, Q> {
		return new RouterBuilder({ bodySchema: this.bodySchema, querySchema: schema });
	}

	build<Response = any>(handler: Handler<Response, Body, Query>): Route<Response, Body, Query> {
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
