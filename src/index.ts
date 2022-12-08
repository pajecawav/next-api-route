import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

type Method = "GET" | "POST" | "PUT" | "DELETE";

type RouteOptions = {
	req: NextApiRequest;
	res: NextApiResponse;
};

type Handler = (options: RouteOptions) => void;

type RoutesMap = Partial<Record<Method, Route>>;

class Route {
	constructor(private handler: Handler) {}

	async handle(req: NextApiRequest, res: NextApiResponse) {
		const options: RouteOptions = {
			req,
			res,
		};

		this.handler(options);
	}
}

class RouteBuilder {
	build(handler: Handler) {
		return new Route(handler);
	}
}

export function route(): RouteBuilder {
	return new RouteBuilder();
}

export function createRoute(routes: RoutesMap): NextApiHandler {
	return (req: NextApiRequest, res: NextApiResponse) => {
		const handler = routes[req.method as Method];

		if (!handler) {
			res.status(405).send("Method Not Supported");
			return;
		}

		handler.handle(req, res);
	};
}
