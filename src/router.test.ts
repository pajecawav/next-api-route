import { createMocks, RequestOptions, ResponseOptions } from "node-mocks-http";
import { describe, expect, test } from "vitest";
import { TypeOf, z } from "zod";
import { createRouter, route } from ".";

// a wrapper with next types
function mockRequestResponse(reqOptions?: RequestOptions, resOptions?: ResponseOptions) {
	return createMocks(reqOptions, resOptions);
}

describe("router", () => {
	test("calls handlers based on request method", async () => {
		const router = createRouter({
			GET: route().build(({ res }) => res.send("GET handler response")),
			POST: route().build(({ res }) => res.send("POST handler response")),
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
			GET: r().build(({ res }) => res.send("GET handler response")),
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
		expect(res._getJSONData()).toHaveProperty("errors");
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
		expect(res._getJSONData()).toHaveProperty("errors");
	});
});
