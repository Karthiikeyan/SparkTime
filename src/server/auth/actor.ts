import { ServiceError } from "../errors";

/**
 * Who is performing an operation. Admin services require an AdminActor as
 * their first argument, so authorization is enforced inside the service
 * layer too — not only by the proxy and route handlers above it.
 */
export type AdminActor = { kind: "admin"; userId: string; login: string };
export type PublicActor = { kind: "public" };
export type Actor = AdminActor | PublicActor;

export const PUBLIC_ACTOR: PublicActor = { kind: "public" };

export function assertAdmin(actor: Actor | null | undefined): asserts actor is AdminActor {
  if (!actor || actor.kind !== "admin" || !actor.userId) {
    throw new ServiceError("forbidden", "Administrator access required.");
  }
}
