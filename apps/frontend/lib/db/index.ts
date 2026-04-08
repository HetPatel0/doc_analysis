import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://bookify:bookify@127.0.0.1:5432/bookify";

const sql = neon(databaseUrl);

export const db = drizzle({ client: sql, schema });
export { schema };
