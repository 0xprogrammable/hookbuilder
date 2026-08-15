import fs from "node:fs";

export function readRegularFileMode(target) {
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`plugin payload path must be a regular non-symlink file: ${target}`);
  }
  return stat.mode & 0o777;
}

export function assertMirroredFileMode(source, target) {
  const sourceMode = readRegularFileMode(source);
  const targetMode = readRegularFileMode(target);
  if (sourceMode !== targetMode) {
    throw new Error(
      `generated plugin payload mode differs from canonical source: ${target} (${octal(targetMode)} != ${octal(sourceMode)})`
    );
  }
  return sourceMode;
}

export function octalFileMode(mode) {
  if (!Number.isInteger(mode) || mode < 0 || mode > 0o777) throw new Error("file mode must be an integer from 0000 through 0777");
  return octal(mode);
}

function octal(mode) {
  return mode.toString(8).padStart(4, "0");
}
