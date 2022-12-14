export type SerializedTextBlock = TextBlock;

export interface OptimisedPhoto {
  src: string;
  width: number;
}

export interface TextBlock extends IBlock {
  kind: "text";
  id: string;
  data: {
    title: string;
    kicker?: string;
    description?: string;
  };
  formatting?: {};
}

export interface PhotoBlock extends IBlock {
  kind: "photo";
  id: string;
  data: {
    src: string;
    title?: string;
    kicker?: string;
    description?: string;
  };
  formatting?: {
    immersive?: boolean;
  };
  _build: {
    height: number;
    width: number;
    exif: any;
    srcset: OptimisedPhoto[];
  };
}

export interface SerializedPhotoBlock extends Partial<PhotoBlock> {
  kind: "photo";
  id: string;
  data: {
    src: string;
    description?: string;
  };
  formatting?: {
    immersive?: boolean;
  };
}

export interface IBlock {
  kind: unknown;
  data: unknown;
  id: string;
  formatting?: unknown;
  _build?: unknown;
}

export type Block = PhotoBlock | TextBlock;
export type SerializedBlock = SerializedPhotoBlock | SerializedTextBlock;

export type Content = {
  name: string;
  title: string;
  kicker?: string;
  blocks: Block[];
  order?: number;
  formatting: {
    overlay?: boolean;
  };
  _build: {
    slug: string;
    timeRange?: [number | null, number | null];
    srcdir: string;
  };
};

export interface SerializedContent {
  // TODO: Move to .data
  name: string;
  title: string;
  kicker?: string;
  blocks: SerializedBlock[];
  formatting: {
    overlay?: boolean;
  };
}

export type OnEditFn = (newBlock: IBlock, newIndex?: number) => void;
export type OnDeleteFn = (index: number) => void;
