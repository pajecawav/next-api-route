import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import type { TypeOf, ZodIssue, ZodSchema } from "zod";

type Method = "GET" | "POST" | "PUT" | "DELETE";

type RouteParams<Response, BodySchema extends ZodSchema, QuerySchema extends ZodSchema> = {
	req: NextApiRequest;
	res: NextApiResponse<Response>;
	// TODO: `body` and `query` should be `never` if no schema were provided
	body: TypeOf<BodySchema>;
	query: TypeOf<QuerySchema>;
};

type ErrorResponse = { errors: ZodIssue[] };

type Handler<Response, BodySchema extends ZodSchema, QuerySchema extends ZodSchema> = (
	options: RouteParams<Response, BodySchema, QuerySchema>
) => void;

type RoutesMap = Partial<Record<Method, Route<any, any, any>>>;

type RouteInit<BodySchema extends ZodSchema, QuerySchema extends ZodSchema> = {
	bodySchema?: BodySchema;
	querySchema?: QuerySchema;
};

class Route<Response, BodySchema extends ZodSchema, QuerySchema extends ZodSchema> {
	private bodySchema?: BodySchema;
	private querySchema?: QuerySchema;

	constructor(
		private handler: Handler<Response, BodySchema, QuerySchema>,
		{ bodySchema, querySchema }: RouteInit<BodySchema, QuerySchema>
	) {
		this.bodySchema = bodySchema;
		this.querySchema = querySchema;
	}

	async handle(req: NextApiRequest, res: NextApiResponse<Response | ErrorResponse>) {
		let body: TypeOf<BodySchema> = undefined;
		if (this.bodySchema) {
			const result = this.bodySchema.safeParse(req.body);
			if (result.success) {
				body = result.data;
			} else {
				// TODO: better error handling
				res.status(400).json({ errors: result.error.issues });
				return;
			}
		}

		let query: TypeOf<QuerySchema> = undefined;
		if (this.querySchema) {
			const result = this.querySchema.safeParse(req.query);
			if (result.success) {
				query = result.data;
			} else {
				// TODO: better error handling
				res.status(400).json({ errors: result.error.issues });
				return;
			}
		}

		// TODO: isn't typesafe (can assign arbitrary values to body and query)
		const options: RouteParams<Response, BodySchema, QuerySchema> = {
			req,
			res,
			body,
			query,
		};

		this.handler(options);
	}
}

type RouteBuilderInit<BodySchema extends ZodSchema, QuerySchema extends ZodSchema> = {
	bodySchema?: BodySchema;
	querySchema?: QuerySchema;
};

class RouteBuilder<BodySchema extends ZodSchema, QuerySchema extends ZodSchema> {
	private bodySchema?: BodySchema;
	private querySchema?: QuerySchema;

	constructor({ bodySchema, querySchema }: RouteBuilderInit<BodySchema, QuerySchema> = {}) {
		this.bodySchema = bodySchema;
		this.querySchema = querySchema;
	}

	body<T extends ZodSchema>(schema: T): RouteBuilder<T, QuerySchema> {
		return new RouteBuilder({ bodySchema: schema, querySchema: this.querySchema });
	}

	query<T extends ZodSchema>(schema: T): RouteBuilder<BodySchema, T> {
		return new RouteBuilder({ bodySchema: this.bodySchema, querySchema: schema });
	}

	build<Response = any>(
		handler: Handler<Response, BodySchema, QuerySchema>
	): Route<Response, BodySchema, QuerySchema> {
		return new Route(handler, { bodySchema: this.bodySchema, querySchema: this.querySchema });
	}
}

export function route(): RouteBuilder<any, any> {
	return new RouteBuilder();
}

export function createRoute(routes: RoutesMap): NextApiHandler {
	return async (req: NextApiRequest, res: NextApiResponse) => {
		const handler = routes[req.method as Method];

		if (!handler) {
			res.status(405).send("Method Not Supported");
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
createRoute({
	GET: route()
		.body(z.object({ foo: z.string(), bar: z.number() }))
		.build(({ req, res, body, query }) => {
			res.status(200).json({ hello: "delete" });
		}),
});
