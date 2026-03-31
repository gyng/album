/**
 * @jest-environment jsdom
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Heading, Caption } from "./Heading";
import { Card } from "./Card";
import { Thumb } from "./Thumb";
import { Input } from "./Input";
import { Select } from "./Select";
import { ChartTooltip } from "./ChartTooltip";
import { SegmentedToggle } from "./SegmentedToggle";
import { Pill, PillButton } from "./Pill";
import { OverlayButton, OverlayButtonLink } from "./OverlayButton";

describe("Heading", () => {
  it("renders the correct element for each level", () => {
    const { container } = render(
      <>
        <Heading level={1}>One</Heading>
        <Heading level={2}>Two</Heading>
        <Heading level={3}>Three</Heading>
      </>,
    );
    expect(container.querySelector("h2")?.textContent).toBe("One");
    expect(container.querySelector("h3")?.textContent).toBe("Two");
    expect(container.querySelector("h4")?.textContent).toBe("Three");
  });

  it("overrides the element with as prop", () => {
    const { container } = render(
      <Heading level={2} as="p">
        Paragraph heading
      </Heading>,
    );
    expect(container.querySelector("p")?.textContent).toBe("Paragraph heading");
    expect(container.querySelector("h3")).toBeNull();
  });

  it("merges className", () => {
    const { container } = render(
      <Heading level={1} className="custom">
        Test
      </Heading>,
    );
    expect(container.querySelector("h2")?.className).toContain("custom");
  });
});

describe("Caption", () => {
  it("renders a p by default", () => {
    render(<Caption>Text</Caption>);
    expect(screen.getByText("Text").tagName).toBe("P");
  });

  it("renders as span when specified", () => {
    render(<Caption as="span">Span text</Caption>);
    expect(screen.getByText("Span text").tagName).toBe("SPAN");
  });

  it("accepts size prop", () => {
    const { container } = render(<Caption size="sm">Large caption</Caption>);
    const el = container.querySelector("p");
    expect(el?.className).toBeTruthy();
  });
});

describe("Card", () => {
  it("renders children in a div by default", () => {
    render(<Card>Content</Card>);
    expect(screen.getByText("Content").tagName).toBe("DIV");
  });

  it("renders as article when specified", () => {
    render(<Card as="article">Article</Card>);
    expect(screen.getByText("Article").tagName).toBe("ARTICLE");
  });

  it("passes through HTML attributes", () => {
    render(<Card data-testid="card">Content</Card>);
    expect(screen.getByTestId("card")).toBeTruthy();
  });
});

describe("Thumb", () => {
  it("renders an img with src and alt", () => {
    render(<Thumb src="/photo.jpg" alt="A photo" />);
    const img = screen.getByAltText("A photo") as HTMLImageElement;
    expect(img.src).toContain("/photo.jpg");
  });

  it("passes through className", () => {
    const { container } = render(
      <Thumb src="/p.jpg" alt="" className="extra" />,
    );
    expect(container.querySelector("img")?.className).toContain("extra");
  });
});

describe("Input", () => {
  it("renders an input element", () => {
    render(<Input placeholder="Type here" />);
    expect(screen.getByPlaceholderText("Type here").tagName).toBe("INPUT");
  });

  it("forwards ref", () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<Input ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it("handles disabled state", () => {
    render(<Input disabled placeholder="Disabled" />);
    expect(
      (screen.getByPlaceholderText("Disabled") as HTMLInputElement).disabled,
    ).toBe(true);
  });
});

describe("Select", () => {
  it("renders a select element with options", () => {
    render(
      <Select defaultValue="b">
        <option value="a">Alpha</option>
        <option value="b">Beta</option>
      </Select>,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("b");
  });

  it("applies compact variant class", () => {
    const { container } = render(
      <Select variant="compact">
        <option>Option</option>
      </Select>,
    );
    const select = container.querySelector("select");
    expect(select?.className).toContain("compact");
  });
});

describe("ChartTooltip", () => {
  it("renders a span with data-tooltip attribute", () => {
    render(<ChartTooltip>Jan · 42</ChartTooltip>);
    const el = screen.getByText("Jan · 42");
    expect(el.tagName).toBe("SPAN");
    expect(el.hasAttribute("data-tooltip")).toBe(true);
  });
});

describe("SegmentedToggle", () => {
  it("renders options as buttons", () => {
    const onChange = jest.fn();
    render(
      <SegmentedToggle
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ]}
        value="a"
        onChange={onChange}
        ariaLabel="Test toggle"
      />,
    );
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("calls onChange when a button is clicked", () => {
    const onChange = jest.fn();
    render(
      <SegmentedToggle
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ]}
        value="a"
        onChange={onChange}
        ariaLabel="Test toggle"
      />,
    );
    fireEvent.click(screen.getByText("Beta"));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("marks the active option with aria-selected", () => {
    render(
      <SegmentedToggle
        options={[
          { value: "x", label: "X" },
          { value: "y", label: "Y" },
        ]}
        value="y"
        onChange={() => {}}
        ariaLabel="Test"
      />,
    );
    expect(screen.getByText("Y").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("X").getAttribute("aria-selected")).toBe("false");
  });
});

describe("Pill / PillButton", () => {
  it("Pill renders an anchor", () => {
    render(<Pill href="/test">Link</Pill>);
    const el = screen.getByText("Link");
    expect(el.tagName).toBe("A");
    expect((el as HTMLAnchorElement).href).toContain("/test");
  });

  it("PillButton renders a button", () => {
    const onClick = jest.fn();
    render(<PillButton onClick={onClick}>Click</PillButton>);
    fireEvent.click(screen.getByText("Click"));
    expect(onClick).toHaveBeenCalled();
  });

  it("applies ghost variant", () => {
    const { container } = render(
      <Pill href="#" variant="ghost">
        Ghost
      </Pill>,
    );
    expect(container.querySelector("a")?.className).toContain("ghost");
  });
});

describe("OverlayButton", () => {
  it("renders a button", () => {
    render(<OverlayButton>Action</OverlayButton>);
    expect(screen.getByText("Action").tagName).toBe("BUTTON");
  });

  it("applies small size class", () => {
    const { container } = render(
      <OverlayButton size="small">×</OverlayButton>,
    );
    expect(container.querySelector("button")?.className).toContain("small");
  });

  it("OverlayButtonLink renders an anchor", () => {
    render(<OverlayButtonLink href="/test">Link</OverlayButtonLink>);
    expect(screen.getByText("Link").tagName).toBe("A");
  });
});
