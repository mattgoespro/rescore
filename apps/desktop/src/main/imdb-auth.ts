import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import type { ImdbAuthStatus } from "../shared/imdb-auth";

export type { ImdbAuthStatus };

export interface ImdbCredentials {
  email: string;
  password: string;
}

interface AuthFile {
  email: string;
  password: string;
  encrypted: boolean;
}

const AUTH_FILE = "imdb-auth.json";

export function createImdbAuthStore(options: {
  dir: string;
  encrypt?(plain: string): string;
  decrypt?(stored: string): string;
}) {
  const path = join(options.dir, AUTH_FILE);
  const canEncrypt = Boolean(options.encrypt && options.decrypt);

  function read(): AuthFile | null {
    try {
      if (!existsSync(path)) return null;
      const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<AuthFile>;
      if (!raw || typeof raw !== "object") return null;
      return {
        email: typeof raw.email === "string" ? raw.email : "",
        password: typeof raw.password === "string" ? raw.password : "",
        encrypted: raw.encrypted === true,
      };
    } catch {
      return null;
    }
  }

  function write(file: AuthFile): void {
    if (!existsSync(options.dir)) mkdirSync(options.dir, { recursive: true });
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, JSON.stringify(file, null, 2), "utf8");
    renameSync(temporary, path);
  }

  function decryptPassword(file: AuthFile): string | null {
    if (!file.password) return "";
    if (!file.encrypted) return file.password;
    if (!options.decrypt) return null;
    try {
      return options.decrypt(file.password);
    } catch {
      return null;
    }
  }

  function status(): ImdbAuthStatus {
    const file = read();
    if (!file) return { email: "", passwordSaved: false };
    const password = decryptPassword(file);
    return {
      email: file.email,
      passwordSaved: Boolean(password),
    };
  }

  function getCredentials(): ImdbCredentials | null {
    const file = read();
    if (!file) return null;
    const password = decryptPassword(file);
    if (password == null || (!file.email && !password)) return null;
    if (!password) return null;
    return { email: file.email, password };
  }

  function setCredentials(email: string, password: string): ImdbAuthStatus {
    const nextEmail = email.trim();
    if (!nextEmail && !password) {
      if (existsSync(path)) unlinkSync(path);
      return { email: "", passwordSaved: false };
    }
    const existing = getCredentials();
    const nextPassword = password || existing?.password || "";
    const encrypted = canEncrypt && Boolean(nextPassword);
    write({
      email: nextEmail,
      password:
        encrypted && options.encrypt
          ? options.encrypt(nextPassword)
          : nextPassword,
      encrypted,
    });
    return {
      email: nextEmail,
      passwordSaved: Boolean(nextPassword),
    };
  }

  return { status, getCredentials, setCredentials };
}
