import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import type { ZodIssue, ZodSchema } from "zod";
import { z } from "zod";

const allowedMethods = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const;

type Method = typeof allowedMethods[number];

// query is always an object
type QueryBase = Record<string, any> & {};

type RouteParams<Response, Body, Query extends QueryBase> = {
	req: NextApiRequest;
	res: NextApiResponse<Response>;
	body: Body;
	query: Query;
};

type ErrorResponse = { errors: ZodIssue[] };

type Handler<Response, Body, Query extends QueryBase> = (
	params: RouteParams<Response, Body, Query>
) => void;

const anySchema = z.any();

type RouteInit<Body, Query> = {
	bodySchema?: ZodSchema<Body>;
	querySchema?: ZodSchema<Query>;
};

class Route<Response, Body, Query extends QueryBase> {
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

type RouteBuilderInit<Body, Query extends QueryBase> = {
	bodySchema?: ZodSchema<Body>;
	querySchema?: ZodSchema<Query>;
};

class RouteBuilder<Body, Query extends QueryBase> {
	private bodySchema?: ZodSchema<Body>;
	private querySchema?: ZodSchema<Query>;

	constructor({ bodySchema, querySchema }: RouteBuilderInit<Body, Query> = {}) {
		this.bodySchema = bodySchema;
		this.querySchema = querySchema;
	}

	body<B>(schema: ZodSchema<B>): RouteBuilder<B, Query> {
		return new RouteBuilder({ bodySchema: schema, querySchema: this.querySchema });
	}

	query<Q extends QueryBase>(schema: ZodSchema<Q>): RouteBuilder<Body, Q> {
		return new RouteBuilder({ bodySchema: this.bodySchema, querySchema: schema });
	}

	build<Response = any>(handler: Handler<Response, Body, Query>): Route<Response, Body, Query> {
		return new Route(handler, { bodySchema: this.bodySchema, querySchema: this.querySchema });
	}
}

export function route(): RouteBuilder<any, QueryBase> {
	return new RouteBuilder();
}

type RouteFn = typeof route;

type RoutesMap = Partial<Record<Method, Route<any, any, any>>>;

export function createRoute(routes: (route: RouteFn) => RoutesMap): NextApiHandler;
export function createRoute(routes: RoutesMap): NextApiHandler;
export function createRoute(routes: RoutesMap | ((route: RouteFn) => RoutesMap)): NextApiHandler {
	const routesMap = typeof routes === "function" ? routes(route) : routes;

	for (const method of Object.keys(routes)) {
		if (!allowedMethods.includes(method as any)) {
			throw new Error(`Unsupported method ${method}`);
		}
	}

	return async (req: NextApiRequest, res: NextApiResponse) => {
		const handler = routesMap[req.method as Method];

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

// TODO: for testing purposes, delete later
// import { z } from "zod";
// const test = route().body(z.object({ foo: z.string(), bar: z.number() }));
// test.build;
// const handler = createRoute({
// 	GET: route()
// 		.body(z.object({ foo: z.string(), bar: z.number() }))
// 		.query(z.object({ asd: z.number() }))
// 		.build<{ hello: string; val: "foo" | "bar" }>(({ req, res, body, query }) => {
// 			res.status(200).json({ hello: query.asd.toString(), val: "foo" });
// 		}),
// });
