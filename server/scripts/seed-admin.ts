import { storage } from "../storage.ts";
import { hashPassword } from "../auth/password.ts";

const hash = await hashPassword("ChangeMe1!Now#");
const user = await storage.createUser({
  email: "fhv@neurogan.com",
  fullName: "Frederik Hejlskov",
  title: "Administrator",
  passwordHash: hash,
  roles: ["ADMIN"],
  createdByUserId: null,
  grantedByUserId: null,
});
console.log("Created admin user:", user.id, user.email);
process.exit(0);
