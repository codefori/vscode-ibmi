import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: [
            "src/api/tests/suites/sourceMemberArchive.test.ts",
            "src/api/tests/suites/sourceMemberPrompt.test.ts",
        ],
        environment: "node",
        testTimeout: 120000,
    },
});
