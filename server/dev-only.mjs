// dev-only.mjs — demo seeds create accounts with a known password or invented
// data: they must never run against a production database.
export function refuseInProduction(what) {
  if (process.env.NODE_ENV !== "production") return;
  console.error(`${what} is for development only: refusing to run with NODE_ENV=production.`);
  process.exit(1);
}
