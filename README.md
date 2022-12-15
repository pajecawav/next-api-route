# next-api-route [![npm](https://img.shields.io/npm/v/next-api-route)](https://www.npmjs.com/package/next-api-route)

Small routing library for [API Routes](https://nextjs.org/docs/api-routes/introduction) in [Next.js](https://nextjs.org/)

# Installation

```sh
npm install next-api-route
# or
yarn add next-api-route
# or
pnpm add next-api-route
```

# Usage

```ts
// pages/api/hello.ts
import { createRouter, route } from "next-api-route";

export default createRouter({
    GET: route().build(({ req, res }) => {
        res.status(200).json({ hello: "world" });
    }),

    POST: route().build(({ req, res }) => {
        // returned value is automatically passed to `res.json`
        return { foo: "bar" };
    }),
});
```

# Validation with Zod

You can use [zod](https://github.com/colinhacks/zod) to validate `req.body` and `req.query`:

```ts
// pages/api/hello.ts
import { createRouter, route } from "next-api-route";
import { z } from "zod";

export default createRouter({
    POST: route()
        .query(
            z.object({
                id: z.string().min(1),
            })
        )
        .body(
            z.object({
                value: z.number(),
            })
        )
        .build(async ({ req, res, query, body }) => {
            // `query` and `body` are fully typed now
            const item = await updateItem(query.id, body.value);
            return item;
        }),
});
```

# Middleware

You can add custom middleware to routes with `.use()` method:

```ts
// pages/api/hello.ts
import { createRouter, route } from "next-api-route";

export default createRouter({
    GET: route()
        .use(async (req, res, next) => {
            const start = Date.now();
            try {
                await next();
            } finally {
                const duration = Date.now() - start;
                console.log(`${req.method} request completed in ${duration}ms`);
            }
        })
        .build(async ({ req, res }) => {
            return { foo: "bar" };
        }),
});
```

Or you can also create a reusable route builder:

```ts
// pages/api/hello.ts
import { createRouter, route, Middleware } from "next-api-route";

const logger: Middleware = async (req, res, next) => {
    const start = Date.now();
    try {
        await next();
    } finally {
        const duration = Date.now() - start;
        console.log(`${req.method} request completed in ${duration}ms`);
    }
};

const loggedRoute = route().use(logger);

export default createRouter({
    GET: loggedRoute.build(async ({ req, res }) => {
        return { foo: "bar" };
    }),

    POST: loggedRoute.build(async ({ req, res }) => {
        return { hello: "world" };
    }),
});
```

# Custom Error Handlers

```ts
// pages/api/hello.ts
import { createRouter, route } from "next-api-route";

export default createRouter(
    {
        GET: route().build(async ({ req, res }) => {
            return { foo: "bar" };
        }),
    },
    {
        // called when there is no route matching request method
        onNotAllowed(method, req, res) {
            res.status(405).send(`Method ${method} isn't supported`);
        },
        // catches all errors inside handlers
        onError(error, req, res) {
            console.error(error);
            res.status(500).send("Oops, something went wrong...");
        },
    }
);
```
