// Downloads the backend OpenAPI contract and regenerates the client.
//   FT_OPENAPI_URL=https://admin.appfreeticket.com/api/v1/openapi.json pnpm sync-openapi
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const url =
	process.env.FT_OPENAPI_URL ??
	"http://admin.localhost:3000/api/v1/openapi.json";
const out = process.env.FT_OPENAPI_OUT ?? "openapi.json";

const res = await fetch(url);
if (!res.ok) {
	console.error(`Could not download the spec (${res.status}) from ${url}`);
	process.exit(1);
}
const spec = await res.json();
writeFileSync(out, `${JSON.stringify(spec, null, 2)}\n`);
console.log(`✓ ${out} updated from ${url}`);

execSync("pnpm generate", { stdio: "inherit" });
console.log("✓ client regenerated in src/client/");
