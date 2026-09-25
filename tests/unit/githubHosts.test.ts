import { describe, expect, test } from "bun:test";
import { apiUrlFor, isPairedApiUrl } from "../../domain/githubHosts.ts";

describe("adresse d'API d'un GitHub", () => {
  test("github.com, GitHub Enterprise Cloud (*.ghe.com) et GitHub Enterprise Server", () => {
    expect(apiUrlFor("https://github.com")).toBe("https://api.github.com");
    expect(apiUrlFor("https://octo.ghe.com")).toBe("https://api.octo.ghe.com");
    expect(apiUrlFor("https://git.example.org")).toBe("https://git.example.org/api/v3");
    expect(apiUrlFor("pas une adresse")).toBeNull();
  });

  test("une paire qui ne va pas est refusée : les jetons partiraient vers un autre hôte", () => {
    expect(isPairedApiUrl("https://github.com", "https://api.github.com")).toBe(true);
    expect(isPairedApiUrl("https://github.com", "https://api.github.com/")).toBe(true);
    expect(isPairedApiUrl("https://github.com", "https://evil.example/api/v3")).toBe(false);
    expect(isPairedApiUrl("https://git.example.org", "https://git.example.org/api/v3")).toBe(true);
    expect(isPairedApiUrl("https://git.example.org", "https://api.github.com")).toBe(false);
  });

  test("boucle locale (faux GitHub de développement) : l'API doit rester locale", () => {
    expect(isPairedApiUrl("http://127.0.0.1:9311", "http://127.0.0.1:9311")).toBe(true);
    expect(isPairedApiUrl("http://localhost:9311", "http://127.0.0.1:9311")).toBe(true);
    expect(isPairedApiUrl("http://127.0.0.1:9311", "https://api.github.com")).toBe(false);
  });
});
