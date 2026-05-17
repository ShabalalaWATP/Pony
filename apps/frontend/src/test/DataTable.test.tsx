import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ColumnDef } from "@tanstack/react-table";
import { describe, expect, it, vi } from "vitest";
import { DataTable } from "@/components/ui/DataTable";

interface Row {
  id: string;
  name: string;
  count: number;
}

const data: Row[] = [
  { id: "a", name: "Alpha", count: 10 },
  { id: "b", name: "Bravo", count: 20 },
  { id: "c", name: "Charlie", count: 30 },
];

const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: "name", header: "Name", cell: (ctx) => ctx.getValue<string>() },
  {
    accessorKey: "count",
    header: "Count",
    cell: (ctx) => <span data-testid="count-cell">{ctx.getValue<number>()}</span>,
  },
];

describe("DataTable", () => {
  it("renders rows for the supplied data", () => {
    render(<DataTable<Row> data={data} columns={columns} getRowId={(r) => r.id} />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
  });

  it("renders the supplied empty state when there is no data", () => {
    render(
      <DataTable<Row>
        data={[]}
        columns={columns}
        emptyState={<div data-testid="empty">nothing here</div>}
      />,
    );
    expect(screen.getByTestId("empty")).toBeInTheDocument();
  });

  it("filters by globalFilter substring", () => {
    render(
      <DataTable<Row> data={data} columns={columns} getRowId={(r) => r.id} globalFilter="alp" />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Bravo")).toBeNull();
  });

  it("fires onRowOpen on row click", async () => {
    const handler = vi.fn();
    render(
      <DataTable<Row> data={data} columns={columns} getRowId={(r) => r.id} onRowOpen={handler} />,
    );
    await userEvent.click(screen.getByText("Bravo"));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ name: "Bravo" }));
  });

  it("sorts when a sortable column header is clicked", async () => {
    render(<DataTable<Row> data={data} columns={columns} getRowId={(r) => r.id} />);
    const nameHeader = screen.getByRole("columnheader", { name: /^name/i });
    await userEvent.click(nameHeader); // asc
    let rows = screen.getAllByTestId("data-table-row");
    expect(rows[0]?.textContent).toContain("Alpha");
    await userEvent.click(nameHeader); // desc
    rows = screen.getAllByTestId("data-table-row");
    expect(rows[0]?.textContent).toContain("Charlie");
  });
});
