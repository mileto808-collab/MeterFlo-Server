import type { InventoryActivityGroup } from "@shared/inventory-activity-groups";
import { inventoryActivityActionLabel } from "@shared/inventory-activity-groups";
import type { OperationsDataset, OperationsRow } from "./inventory-operations-data";

export function groupedInventoryActivity(dataset: OperationsDataset, groups: InventoryActivityGroup[]): OperationsDataset {
  const rows = new Map(dataset.rows.map(row => [row.id, row]));
  return {
    ...dataset,
    columns: [...dataset.columns.map(column => ({ ...column, label:
      ({ reference: "Activity", receipt: "Receipts", action: "Actions", quantity: "Quantities per transaction",
        damaged: "Damaged quantities per transaction" } as Record<string, string>)[column.key] ?? column.label })),
      { key: "transactions", label: "Transactions" }, { key: "history", label: "Complete transaction history" }],
    rows: groups.map(group => {
      const children = group.receipts.map(receipt => rows.get(receipt.id)).filter((row): row is OperationsRow => !!row)
        .map(row => ({ ...row, search: `${row.search} ${group.title.toLocaleLowerCase()}` }));
      const cells: OperationsRow["cells"] = {};
      for (const column of dataset.columns) cells[column.key] = [...new Set(children.map(row => row.cells[column.key])
        .filter(value => value !== "" && value !== undefined))].join("; ");
      const latest = children.at(-1);
      Object.assign(cells, { reference: group.title, sequence: group.latestSequence, transactions: children.length,
        occurredAt: latest?.cells.occurredAt ?? "", date: latest?.cells.date ?? "",
        history: children.map(row => dataset.columns.filter(column => row.cells[column.key] !== "" && row.cells[column.key] !== undefined)
          .map(column => `${column.label}: ${column.key === "action" ? inventoryActivityActionLabel(String(row.cells[column.key])) : row.cells[column.key]}`).join(" · ")).join("\n") });
      return { id: group.id, search: `${group.title} ${children.map(row => row.search).join(" ")}`.toLocaleLowerCase(),
        cells, facets: {}, children, timestamps: children.flatMap(row => row.timestamps ?? []) };
    }),
  };
}
