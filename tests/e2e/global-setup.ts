import { resetDb, seedSemester } from "../integration/helpers";

export default async function globalSetup() {
  await resetDb();
  await seedSemester();
}
