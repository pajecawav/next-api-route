import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import type { ZodIssue, ZodSchema } from "zod";

type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

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
	options: RouteParams<Response, Body, Query>
) => void;

type RoutesMap = Partial<Record<Method, Route<any, any, any>>>;

type RouteInit<Body, Query> = {
	bodySchema?: ZodSchema<Body>;
	querySchema?: ZodSchema<Query>;
};

class Route<Response, Body, Query extends QueryBase> {
	private bodySchema?: ZodSchema<Body>;
	private querySchema?: ZodSchema<Query>;

	constructor(
		private handler: Handler<Response, Body, Query>,
		{ bodySchema, querySchema }: RouteInit<Body, Query>
	) {
		this.bodySchema = bodySchema;
		this.querySchema = querySchema;
	}

	async handle(req: NextApiRequest, res: NextApiResponse<Response | ErrorResponse>) {
		// TODO: how to get rid of any?
		let body: Body = undefined as any;
		if (this.bodySchema) {
			// TODO: use async parsing (https://github.com/colinhacks/zod#parseasync)
			const result = this.bodySchema.safeParse(req.body);
			if (result.success) {
				body = result.data satisfies Body;
			} else {
				// TODO: better error handling
				res.status(400).json({ errors: result.error.issues });
				return;
			}
		}

		// TODO: how to get rid of any?
		let query: Query = undefined as any;
		if (this.querySchema) {
			const result = this.querySchema.safeParse(req.query);
			if (result.success) {
				query = result.data satisfies Query;
			} else {
				// TODO: better error handling
				res.status(400).json({ errors: result.error.issues });
				return;
			}
		}

		const options: RouteParams<Response, Body, Query> = {
			req,
			res,
			body,
			query,
		};

		this.handler(options);
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

export function createRoute(routes: RoutesMap): NextApiHandler {
	return async (req: NextApiRequest, res: NextApiResponse) => {
		const handler = routes[req.method as Method];

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
import { z } from "zod";
const test = route().body(z.object({ foo: z.string(), bar: z.number() }));
test.build;
const handler = createRoute({
	GET: route()
		.body(z.object({ foo: z.string(), bar: z.number() }))
		.query(z.object({ asd: z.number() }))
		.build<{ hello: string; val: "foo" | "bar" }>(({ req, res, body, query }) => {
			res.status(200).json({ hello: query.asd.toString(), val: "foo" });
		}),
});
