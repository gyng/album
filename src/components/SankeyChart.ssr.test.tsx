import { renderToStaticMarkup } from "react-dom/server";
import { SankeyChart } from "./SankeyChart";

let mockSankeyProps: any = null;

jest.mock("@nivo/sankey", () => ({
  ResponsiveSankey: (props: any) => {
    mockSankeyProps = props;
    return null;
  },
}));

describe("SankeyChart server rendering", () => {
  it("uses token fallbacks when browser CSS is unavailable", () => {
    renderToStaticMarkup(
      <SankeyChart
        flow={{
          nodes: [
            { id: "a", label: "A", count: 1, depth: 0 },
            { id: "b", label: "B", count: 1, depth: 1 },
          ],
          links: [{ source: "a", target: "b", count: 1 }],
        }}
      />,
    );

    expect(mockSankeyProps.margin).toEqual({ top: 12, right: 84, bottom: 12, left: 84 });
  });
});
