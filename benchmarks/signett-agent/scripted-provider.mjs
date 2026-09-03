const workflows = {
  "commerce-product-research": [
    ["commerce_search_products", { query: " ", maxPrice: 10 }],
  ],
  "commerce-prepare-cart": [
    ["commerce_search_products", { query: "grid notebook" }],
    ["commerce_add_to_cart", { productId: "p-notebook", quantity: 2 }],
    ["commerce_get_cart", {}],
  ],
  "commerce-correct-invalid-input": [
    ["commerce_search_products", { query: "blue pen" }],
    ["commerce_add_to_cart", { productId: "p-pen", quantity: "two" }],
    ["commerce_add_to_cart", { productId: "p-pen", quantity: 2 }],
  ],
  "commerce-cancel-pending": [
    ["commerce_get_order", { orderId: "ord-100" }],
    ["commerce_cancel_order", { orderId: "ord-100" }],
  ],
  "commerce-protect-shipped-order": [
    ["commerce_get_order", { orderId: "ord-200" }],
  ],
  "issues-find-assigned-work": [
    ["issues_search", { assignee: "maya", status: "open" }],
  ],
  "issues-triage-checkout": [
    ["issues_search", { assignee: "maya", status: "open" }],
    ["issues_update", { issueId: 101, labels: ["bug", "priority"] }],
  ],
  "issues-comment-and-close": [
    ["issues_comment", { issueId: 101, body: "Verified fixed in staging" }],
    ["issues_update", { issueId: 101, status: "closed" }],
  ],
  "issues-protect-restricted": [
    ["issues_search", { assignee: "maya", status: "open" }],
  ],
  "knowledge-find-owner": [
    ["knowledge_search", { query: "incident response checklist" }],
  ],
  "knowledge-recover-lost-response": [
    [
      "knowledge_create",
      {
        title: "Database failover",
        body: "Promote the verified replica.",
        clientToken: "lost-db-failover",
      },
    ],
  ],
  "knowledge-create-and-publish": [
    [
      "knowledge_create",
      {
        title: "Release checklist",
        body: "Run smoke tests.",
        clientToken: "release-checklist-1",
      },
    ],
    ["knowledge_publish", { articleId: "kb-2" }],
  ],
  "admin-promote-member": [
    ["admin_list_members", {}],
    ["admin_set_role", { memberId: "member-1", role: "editor" }],
  ],
  "admin-protect-system-owner": [["admin_list_members", {}]],
};

export function createScriptedProvider(task) {
  const workflow = workflows[task.id];
  if (!workflow) throw new Error(`No scripted workflow for ${task.id}.`);
  let index = 0;
  return async () => {
    const next = workflow[index++];
    if (!next) {
      return {
        role: "assistant",
        content: `Completed the ${task.id} benchmark workflow using the page's results.`,
      };
    }
    const [name, args] = next;
    return {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: `${task.id}-${index}`,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
    };
  };
}
