import { NextApiRequest, NextApiResponse } from "next";
import { createMocks, RequestOptions, ResponseOptions } from "node-mocks-http";
import { describe, expect, test } from "vitest";
import { TypeOf, z } from "zod";
import { createRouter, Middleware, RequestMethod, route } from ".";

// a wrapper with next types
function mockRequestResponse(reqOptions?: RequestOptions, resOptions?: ResponseOptions) {
	return createMocks<NextApiRequest, NextApiResponse>(reqOptions, resOptions);
}

describe("router", () => {
	test("calls handlers based on request method", async () => {
		const router = createRouter({
			GET: route().build(({ res }) => {
				res.send("GET handler response");
			}),
			POST: route().build(({ res }) => {
				res.send("POST handler response");
			}),
		});

		const mockGet = mockRequestResponse({ method: "GET" });
		await router(mockGet.req, mockGet.res);
		expect(mockGet.res.statusCode).toBe(200);
		expect(mockGet.res._getData()).toBe("GET handler response");

		const mockPost = mockRequestResponse({ method: "POST" });
		await router(mockPost.req, mockPost.res);
		expect(mockPost.res.statusCode).toBe(200);
		expect(mockPost.res._getData()).toBe("POST handler response");
	});

	test("accepts callback for providing map of handlers", async () => {
		const router = createRouter(r => ({
			GET: r().build(({ res }) => {
				res.send("GET handler response");
			}),
		}));

		const { req, res } = mockRequestResponse({ method: "GET" });
		await router(req, res);
		expect(res.statusCode).toBe(200);
		expect(res._getData()).toBe("GET handler response");
	});

	test("throws when unsupported method was provided", async () => {
		expect(() => {
			createRouter({
				// @ts-expect-error
				FOO: route().build(({ res }) => res.send("ok")),
			});
		}).toThrow(/unsupported/i);
	});

	test("returns 405 if method handler doesn't exist", async () => {
		const router = createRouter({});

		const { req, res } = mockRequestResponse({ method: "GET" });
		await router(req, res);
		expect(res.statusCode).toBe(405);
	});

	test("returns 500 if handler throws an error", async () => {
		const router = createRouter({
			GET: route().build(() => {
				throw new Error("foo bar");
			}),
		});

		const { req, res } = mockRequestResponse({ method: "GET" });
		await router(req, res);
		expect(res.statusCode).toBe(500);
	});

	test("processes values returned from handler", async () => {
		const value = { hello: "world", foo: 123 };

		const router = createRouter({
			GET: route().build(() => value),
		});

		const { req, res } = mockRequestResponse();
		await router(req, res);

		expect(res.statusCode).toBe(200);
		expect(res._getJSONData()).toStrictEqual(value);
	});

	test("parses body", async () => {
		const schema = z.object({ foo: z.string(), bar: z.number() });

		let parsedBody;

		const router = createRouter({
			GET: route()
				.body(schema)
				.build(({ res, body }) => {
					parsedBody = body;
					res.send("ok");
				}),
		});

		type Data = TypeOf<typeof schema>;
		const payload: Data = { foo: "hello world", bar: 1234 };

		const { req, res } = mockRequestResponse({ body: payload });
		await router(req, res);

		expect(res.statusCode).toBe(200);
		expect(parsedBody).toStrictEqual(payload);
	});

	test("returns errors on invalid body", async () => {
		const schema = z.object({ foo: z.string(), bar: z.number() });

		const router = createRouter({
			GET: route()
				.body(schema)
				.build(({ res, body }) => res.send("ok")),
		});

		const payload = { foo: 4321 };

		const { req, res } = mockRequestResponse({ body: payload });
		await router(req, res);

		expect(res.statusCode).toBe(400);
		const json = res._getJSONData();
		expect(json).toHaveProperty("message");
		expect(json).toHaveProperty("errors");
	});

	test("parses query", async () => {
		const schema = z.object({ baz: z.number(), hello: z.boolean() });

		let parsedQuery;

		const router = createRouter({
			GET: route()
				.query(schema)
				.build(({ res, query }) => {
					parsedQuery = query;
					res.send("ok");
				}),
		});

		type Data = TypeOf<typeof schema>;
		const payload: Data = { baz: 4444, hello: true };

		const { req, res } = mockRequestResponse({ query: payload });
		await router(req, res);

		expect(res.statusCode).toBe(200);
		expect(parsedQuery).toStrictEqual(payload);
	});

	test("returns errors on invalid query", async () => {
		const schema = z.object({ baz: z.number(), hello: z.boolean() });

		const router = createRouter({
			GET: route()
				.query(schema)
				.build(({ res, body }) => res.send("ok")),
		});

		const payload = { hello: "world" };

		const { req, res } = mockRequestResponse({ query: payload });
		await router(req, res);

		expect(res.statusCode).toBe(400);
		const json = res._getJSONData();
		expect(json).toHaveProperty("message");
		expect(json).toHaveProperty("errors");
	});

	test("passes request through middleware", async () => {
		let middlewareWasCalled = false;
		const middleware: Middleware = async (req, res, next) => {
			await next();
			middlewareWasCalled = true;
		};

		const router = createRouter({
			GET: route()
				.use(middleware)
				.build(() => "hello"),
		});

		const { req, res } = mockRequestResponse();
		await router(req, res);

		expect(middlewareWasCalled).toBe(true);
		expect(res.statusCode).toBe(200);
		expect(res._getJSONData()).toBe("hello");
	});

	test("calls custom handler on unsupported method", async () => {
		let handlerWasCalledWithMethod: RequestMethod | null = null;
		const router = createRouter(
			{},
			{
				onNotAllowed(method, req, res) {
					handlerWasCalledWithMethod = method;
					res.status(500).send("not allowed");
				},
			}
		);

		const { req, res } = mockRequestResponse({ method: "POST" });
		await router(req, res);

		expect(handlerWasCalledWithMethod).toBe("POST");
		expect(res.statusCode).toBe(500);
		expect(res._getData()).toBe("not allowed");
	});

	test("calls custom error handler", async () => {
		let handlerWasCalledWithError: any = null;
		const errorToThrow = new Error("foobar");

		const router = createRouter(
			{
				GET: route().build(() => {
					throw errorToThrow;
				}),
			},
			{
				onError(error, req, res) {
					handlerWasCalledWithError = error;
					res.status(500).send("error occured");
				},
			}
		);

		const { req, res } = mockRequestResponse();
		await router(req, res);

		expect(handlerWasCalledWithError).toBe(errorToThrow);
		expect(res.statusCode).toBe(500);
		expect(res._getData()).toBe("error occured");
	});
});
