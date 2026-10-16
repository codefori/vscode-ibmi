import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["src/api/tests/suites/sourceMemberArchive.test.ts"],
        environment: "node",
        testTimeout: 120000,
    },
});
