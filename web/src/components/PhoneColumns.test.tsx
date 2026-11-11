import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PhoneColumns } from "./PhoneColumns";

describe("PhoneColumns", () => {
  it("says what's hidden, and brings it back with word of how to reach it", () => {
    const { container } = render(
      <PhoneColumns hidden={["Site", "Big blind"]}>
        <table />
      </PhoneColumns>,
    );
    const box = container.firstElementChild!;
    expect(box).not.toHaveAttribute("data-all");
    expect(screen.getByText(/^Hidden at this width: Site, Big blind\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show them" }));
    expect(box).toHaveAttribute("data-all");
    expect(screen.getByText(/Scroll sideways/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide them" }));
    expect(box).not.toHaveAttribute("data-all");
  });

  it("says nothing where no column is hidden", () => {
    render(
      <PhoneColumns hidden={[]}>
        <table />
      </PhoneColumns>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});
