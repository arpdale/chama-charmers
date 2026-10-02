import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  auth: true,
  // These services are GA; preview.* is deprecated in the current CLI.
  buckets: { media: { access: "private" } },
  functions: { api: { name: "api", source: "./hello.ts" } },
  branch: () => ({
    postgres: {
      computeSettings: {
        autoscalingLimitMinCu: 0.25,
        autoscalingLimitMaxCu: 0.25,
        suspendTimeout: "5m",
      },
    },
  }),
});
