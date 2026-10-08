# Build troubleshooting

The Redis client uses the default ioredis import for NodeNext/TypeScript compatibility.

Fastify's global error handler explicitly narrows `unknown` before reading status/message.

If dependencies were installed before a package change, run:

```bash
rm -rf node_modules
npm install
npm run build
```
