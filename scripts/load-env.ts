/**
 * Side-effect import that gives node scripts the same env Next.js sees.
 *
 * `dotenv/config` only reads `.env`; Next.js reads `.env.local` first and that
 * is where our real keys live. Import this BEFORE anything that reads
 * process.env — import order is evaluation order.
 */
import { config } from 'dotenv'
import { resolve } from 'node:path'

for (const file of ['.env.local', '.env']) {
  config({ path: resolve(process.cwd(), file), override: false, quiet: true })
}
