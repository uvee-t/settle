import { defineConfig } from "vitest/config";
import dotenv from "dotenv";

// Integration tests must use the dedicated test environment.
delete process.env.DATABASE_URL;
dotenv.config({ path: ".env.test", override: true });

export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],
        environment: "node",
        globals: false,
        clearMocks: true,
        restoreMocks: true,
        testTimeout: 10_000,
    },
});
