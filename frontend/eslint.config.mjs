import next from "eslint-config-next/core-web-vitals";

const config = [...next, { ignores: [".next/**", "lib/api-types.ts", "next-env.d.ts"] }];

export default config;
