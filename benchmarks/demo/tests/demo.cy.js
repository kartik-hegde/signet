describe("Signett customer demo", () => {
  it("replays the speed and trust stories from benchmark evidence", () => {
    cy.visit("/demo/");
    cy.contains("The fast path").should("be.visible");
    cy.contains("Recorded benchmark").should("be.visible");

    cy.get("#run-race").click();
    cy.contains("Same payment. Same final state. Far less agent work.", { timeout: 8000 })
      .should("be.visible");
    cy.get('[data-lane="ui"] [data-metric="duration"]').should("contain", "ms");
    cy.get('[data-lane="webmcp_raw"] [data-result]').should("contain", "DB");
    cy.get('[data-lane="webmcp_signett"] [data-result]').should("contain", "DB");
    cy.screenshot("signett-demo-speed", { capture: "viewport" });

    cy.get('.view-button[data-view-target="safety"]').click();
    cy.get("#run-fault").click();
    cy.get("#raw-outcome-status", { timeout: 4000 }).should("contain", "Duplicate effect");
    cy.get("#guarded-outcome-status").should("contain", "Clean state");
    cy.get("#raw-report").should("contain", "success");
    cy.get("#guarded-report").should("contain", "unknown");
    cy.get("#raw-state .state-row").should("have.length", 4).and("be.visible");
    cy.get("#guarded-state .state-row").should("have.length", 4).and("be.visible");
    cy.wait(150);
    cy.screenshot("signett-demo-trust", { capture: "viewport" });
  });

  it("keeps the story usable on a phone-sized screen", () => {
    cy.viewport(390, 844);
    cy.visit("/demo/");
    cy.contains("The fast path").should("be.visible");
    cy.window().then((win) => {
      expect(win.document.documentElement.scrollWidth).to.be.at.most(win.innerWidth);
    });
    cy.get('.view-button[data-view-target="safety"]').click();
    cy.contains("Response lost after commit").should("be.visible");
  });
});
