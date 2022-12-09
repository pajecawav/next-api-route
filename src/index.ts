import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import type { ZodSchema, TypeOf, ZodIssue } from "zod";

type Method = "GET" | "POST" | "PUT" | "DELETE";

type RouteOptions<Response, BodySchema extends ZodSchema> = {
	req: NextApiRequest;
	res: NextApiResponse<Response>;
	body: TypeOf<BodySchema>;
};

type ErrorResponse = { errors: ZodIssue[] };

type Handler<Response, BodySchema extends ZodSchema> = (
	options: RouteOptions<Response, BodySchema>
) => void;

type RoutesMap = Partial<Record<Method, Route<any, any>>>;

type RouteInit<BodySchema extends ZodSchema> = {
	bodySchema?: BodySchema;
};

class Route<Response, BodySchema extends ZodSchema> {
	private bodySchema?: BodySchema;

	constructor(
		private handler: Handler<Response, BodySchema>,
		{ bodySchema }: RouteInit<BodySchema>
	) {
		this.bodySchema = bodySchema;
	}

	async handle(req: NextApiRequest, res: NextApiResponse<Response | ErrorResponse>) {
		type $Body = TypeOf<BodySchema>;

		let body: $Body = undefined;
		if (this.bodySchema) {
			const result = this.bodySchema.safeParse(req.body);
			if (result.success) {
				body = result.data;
			} else {
				// TODO: better error handling
				const issues = result.error.issues;
				res.status(400).json({ errors: issues });
				return;
			}
		}

		const options: RouteOptions<Response, BodySchema> = {
			req,
			res,
			body,
		};

		this.handler(options);
	}
}

type RouteBuilderInit<BodySchema extends ZodSchema = any> = {
	bodySchema?: BodySchema;
};

class RouteBuilder<BodySchema extends ZodSchema = any> {
	private bodySchema?: BodySchema;

	constructor({ bodySchema }: RouteBuilderInit<BodySchema> = {}) {
		this.bodySchema = bodySchema;
	}

	body<T extends ZodSchema>(schema: T): RouteBuilder<T> {
		return new RouteBuilder({ bodySchema: schema });
	}

	build<Response = any>(handler: Handler<Response, BodySchema>): Route<Response, BodySchema> {
		return new Route(handler, { bodySchema: this.bodySchema });
	}
}

export function route(): RouteBuilder {
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
		.build(({ req, res, body }) => {
			res.status(200).json({ hello: "delete" });
		}),
});
