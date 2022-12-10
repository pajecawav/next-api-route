import { NextApiRequest, NextApiResponse } from "next";
import { createMocks } from "node-mocks-http";
import { describe, expect, test } from "vitest";
import { createRouter, route } from ".";

describe("router", () => {
	test("calls correct handler based on request method", async () => {
		const router = createRouter({
			GET: route().build(({ res }) => res.send("GET handler response")),
			POST: route().build(({ res }) => res.send("POST handler response")),
		});

		const getMock = createMocks<NextApiRequest, NextApiResponse>({ method: "GET" });
		await router(getMock.req, getMock.res);
		expect(getMock.res.statusCode).toBe(200);
		expect(getMock.res._getData()).toBe("GET handler response");

		const postMock = createMocks<NextApiRequest, NextApiResponse>({ method: "POST" });
		await router(postMock.req, postMock.res);
		expect(postMock.res.statusCode).toBe(200);
		expect(postMock.res._getData()).toBe("POST handler response");
	});
});
