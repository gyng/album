import { useEffect, useState } from "react";
import type { FolderListing } from "../api.ts";

export const FolderBar = ({
  listing,
  onOpen,
}: {
  listing: FolderListing;
  onOpen: (path: string) => void;
}) => {
  const [input, setInput] = useState(listing.path);
  useEffect(() => setInput(listing.path), [listing.path]);

  const join = (name: string) => `${listing.path.replace(/\/+$/, "")}/${name}`;

  return (
    <div className="folderBar">
      <div className="folderBar__row">
        <button
          onClick={() => listing.parent && onOpen(listing.parent)}
          disabled={!listing.parent}
          title="Parent folder"
        >
          ⬆
        </button>
        <input
          className="pathInput"
          value={input}
          spellCheck={false}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onOpen(input)}
          placeholder="/path/to/photos"
        />
        <button onClick={() => onOpen(input)}>Open</button>
      </div>
      {listing.subdirs.length > 0 ? (
        <div className="subdirs">
          {listing.subdirs.map((d) => (
            <button
              key={d.name}
              className={["chip", d.imageCount === 0 ? "chip--empty" : ""].filter(Boolean).join(" ")}
              onClick={() => onOpen(join(d.name))}
              title={`${d.imageCount} image${d.imageCount === 1 ? "" : "s"}`}
            >
              {d.name}
              {d.imageCount > 0 ? <span className="chip__count">{d.imageCount}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};
