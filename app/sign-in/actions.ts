'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/db/server'

/**
 * Where to land after signing in.
 *
 * `startsWith('/')` is not enough on its own: "//evil.example" and "/\\evil.example"
 * both start with a slash and are protocol-relative URLs, so redirecting to one
 * sends the freshly authenticated user straight off this origin. Only a path
 * that continues with something other than a slash or a backslash is accepted.
 */
const RELATIVE_PATH = /^\/(?![/\\]).*$/

const credentials = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  // Falls back to the default landing page rather than failing the sign-in: a
  // crafted `?next=` should be ignored, not turned into "you cannot sign in".
  next: z.string().regex(RELATIVE_PATH).optional().catch(undefined),
})

export type SignInState = { error?: string }

export async function signIn(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') || undefined,
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  // Deliberately generic: do not reveal whether the account exists.
  if (error) return { error: 'Email or password is incorrect.' }

  revalidatePath('/', 'layout')
  redirect(parsed.data.next ?? '/search')
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/sign-in')
}
