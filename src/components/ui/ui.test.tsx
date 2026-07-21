/**
 * @jest-environment jsdom
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  Caption,
  Button,
  ButtonLink,
  Card,
  ChartTooltip,
  Heading,
  Input,
  KeyHint,
  OverlayButton,
  OverlayButtonLink,
  Pill,
  PillButton,
  Select,
  Thumb,
} from ".";

describe("Button / ButtonLink", () => {
  it("does not submit forms by default and preserves explicit link destinations", () => {
    render(
      <>
        <Button>Safe action</Button>
        <Button type="submit">Submit action</Button>
        <ButtonLink href="/test">Linked action</ButtonLink>
      </>,
    );

    expect(screen.getByRole("button", { name: "Safe action" })).toHaveAttribute("type", "button");
    expect(screen.getByRole("button", { name: "Submit action" })).toHaveAttribute("type", "submit");
    expect(screen.getByRole("link", { name: "Linked action" })).toHaveAttribute("href", "/test");
  });

  it("forwards its ref", () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Focus target</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});

describe("KeyHint", () => {
  it("renders a semantic keyboard hint", () => {
    render(<KeyHint>Enter</KeyHint>);
    expect(screen.getByText("Enter").tagName).toBe("KBD");
  });
});

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
});

describe("Caption", () => {
  it("uses paragraph semantics by default and permits an inline caption", () => {
    render(
      <>
        <Caption>Text</Caption>
        <Caption as="span">Span text</Caption>
      </>,
    );
    expect(screen.getByText("Text").tagName).toBe("P");
    expect(screen.getByText("Span text").tagName).toBe("SPAN");
  });
});

describe("Card", () => {
  it("uses a neutral container by default and permits article semantics", () => {
    render(
      <>
        <Card>Content</Card>
        <Card as="article">Article</Card>
      </>,
    );
    expect(screen.getByText("Content").tagName).toBe("DIV");
    expect(screen.getByText("Article").tagName).toBe("ARTICLE");
  });
});

describe("Thumb", () => {
  it("preserves image accessibility attributes and defaults omitted alt text to decorative", () => {
    const { container } = render(
      <>
        <Thumb src="/photo.jpg" alt="A photo" />
        <Thumb src="/decorative.jpg" />
      </>,
    );
    const img = screen.getByAltText("A photo") as HTMLImageElement;
    expect(img.src).toContain("/photo.jpg");
    expect(container.querySelector('img[src="/decorative.jpg"]')).toHaveAttribute("alt", "");
  });
});

describe("Input", () => {
  it("forwards its ref to the native control", () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<Input ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
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
});

describe("ChartTooltip", () => {
  it("renders a span with data-tooltip attribute", () => {
    render(<ChartTooltip>Jan · 42</ChartTooltip>);
    const el = screen.getByText("Jan · 42");
    expect(el.tagName).toBe("SPAN");
    expect(el.hasAttribute("data-tooltip")).toBe(true);
  });
});

describe("Pill / PillButton", () => {
  it("keeps links navigable and actions non-submitting", () => {
    const onClick = jest.fn();
    render(
      <>
        <Pill href="/test">Link</Pill>
        <PillButton onClick={onClick}>Click</PillButton>
      </>,
    );

    expect(screen.getByRole("link", { name: "Link" })).toHaveAttribute("href", "/test");
    expect(screen.getByRole("button", { name: "Click" })).toHaveAttribute("type", "button");
    fireEvent.click(screen.getByText("Click"));
    expect(onClick).toHaveBeenCalled();
  });
});

describe("OverlayButton", () => {
  it("keeps actions non-submitting and links navigable", () => {
    render(
      <>
        <OverlayButton>Action</OverlayButton>
        <OverlayButtonLink href="/test">Link</OverlayButtonLink>
      </>,
    );
    expect(screen.getByRole("button", { name: "Action" })).toHaveAttribute("type", "button");
    expect(screen.getByRole("link", { name: "Link" })).toHaveAttribute("href", "/test");
  });
});
