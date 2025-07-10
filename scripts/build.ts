import { execSync } from "child_process";
import { resolve } from "path";
import { existsSync, rmSync } from "fs";

const buildOrder = ["nodeflow"];
const packagesDir = resolve(import.meta.dir, "../packages");

console.log("🚀 Starting package builds...\n");

for (const pkg of buildOrder) {
  const packagePath = resolve(packagesDir, pkg);

  if (!existsSync(packagePath)) {
    console.error(`⚠️ Package "${pkg}" does not exist, skipping.\n`);
    continue;
  }

  try {
    const distPath = resolve(packagePath, "dist");
    if (existsSync(distPath)) {
      rmSync(distPath, { recursive: true });
      console.log(`🗑️  Removed "${pkg}" dist folder`);
    }

    console.log(`🔨 Building "${pkg}"...`);
    execSync("tsc", { cwd: packagePath, stdio: "inherit" });
    console.log(`✅ Successfully built "${pkg}"`);

    const testFiles = Array.from(
      new Bun.Glob("**/*.test.*").scanSync(resolve(packagePath, "dist"))
    );
    if (testFiles.length > 0) {
      for (const file of testFiles) {
        rmSync(resolve(packagePath, "dist", file));
      }
      console.log(`🗑️  Removed ${testFiles.length} test file artifacts`);
    }
    console.log("");
  } catch (error) {
    console.error(`❌ Failed to build "${pkg}". Stopping build process.\n`);
    process.exit(1);
  }
}

console.log("🎉 All packages built successfully!");
