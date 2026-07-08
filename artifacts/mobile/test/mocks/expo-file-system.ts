// Lightweight in-memory stand-in for expo-file-system's File/Paths API so
// components importing the GPX export flow can render under jsdom.
export const Paths = { cache: "/cache" };

export class File {
  name: string;
  exists = false;
  private content = "";

  constructor(_dir: unknown, name: string) {
    this.name = name;
  }

  get uri() {
    return `file:///cache/${this.name}`;
  }

  create() {
    this.exists = true;
  }

  delete() {
    this.exists = false;
    this.content = "";
  }

  write(content: string) {
    this.content = content;
  }
}
