import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { computeAccessibleName } from "dom-accessibility-api";
import App from "./App.jsx";

describe("accessibilité de l’interface", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => cleanup());

  it("expose la valeur et le nom du séparateur redimensionnable", () => {
    render(<App />);
    const separator = screen.getByRole("separator", { name: "Redimensionner le panneau de données" });
    expect(separator.getAttribute("aria-orientation")).toBe("vertical");
    expect(separator.getAttribute("aria-valuemin")).toBe("250");
    expect(separator.getAttribute("aria-valuemax")).toBe("560");
    expect(Number(separator.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(250);
  });

  it("donne un nom accessible aux boutons et champs rendus", () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Jeu d’exemple" }));

    const interactive = container.querySelectorAll("button, input:not([type='file']), select, textarea");
    const unnamed = [...interactive].filter((element) => !computeAccessibleName(element).trim());
    expect(unnamed).toEqual([]);
  });

  it("affiche la nouvelle marque, révèle tout le tracé DRX et traduit l’accueil", () => {
    const { container } = render(<App />);

    expect(screen.getAllByText("PhaseCanvas").length).toBeGreaterThan(0);
    const animatedGeometry = container.querySelectorAll(".workspace-asset__signal, .workspace-asset__stick");
    expect(animatedGeometry.length).toBeGreaterThan(0);
    expect([...animatedGeometry].every((element) => element.getAttribute("pathLength") === "1")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "FR" }));
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByRole("heading", { name: "Compose a diffraction figure" })).toBeTruthy();
    expect(screen.getByText("Import the acquisitions, add the references, apply signal processing, then produce a publication-ready scientific figure.")).toBeTruthy();
    expect(screen.getByText("Processing happens entirely locally in the browser.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import patterns" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add phases" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sample data" })).toBeTruthy();
  });
});
