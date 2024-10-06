/* eslint react-hooks/rules-of-hooks: 0 */

import { GetStaticPaths, GetStaticProps, NextPage } from "next";
import Head from "next/head";
import React from "react";
import { getAlbumFromName, getAlbumNames } from "../../services/album";
import { serializeContentBlock } from "../../services/serialize";
import { Block, Content, PhotoBlock } from "../../services/types";
import { BlockControlOptions } from "../../components/editor/BlockControl";
import { Nav } from "../../components/Nav";
import { EditPhotoBlockOptions } from "../../components/Photo";
import { PhotoAlbum } from "../../components/PhotoAlbum";
import { EditTextBlockOptions } from "../../components/TextBlock";
import styles from "./album.module.css";

type PageProps = {
  album?: Content;
  edit?: boolean;
  editable?: boolean;
};

const Album: NextPage<PageProps> = ({ album, edit, editable }) => {
  if (!album) {
    return <div>This seems to be missing.</div>;
  }

  // Have a stateful album so we can edit
  const [statefulAlbum, setStatefulAlbum] = React.useState(album);
  React.useEffect(() => {
    setStatefulAlbum(album);
  }, [album]);

  const editPhotoBlockOptions: EditPhotoBlockOptions = {
    onEdit: (newBlock, newIndex) => {
      const newBlocks = [...statefulAlbum.blocks];
      const oldIndex = newBlocks.findIndex((b) => b.id === newBlock.id);
      newBlocks.splice(oldIndex, 1);
      newBlocks.splice(newIndex ?? oldIndex, 0, newBlock as PhotoBlock);

      setStatefulAlbum({
        ...statefulAlbum,
        blocks: newBlocks,
      });
    },
    onDelete: (oldIndex) => {
      const newBlocks = [...statefulAlbum.blocks];
      if (oldIndex != null) {
        newBlocks.splice(oldIndex, 1);
      }
      setStatefulAlbum({
        ...statefulAlbum,
        blocks: newBlocks,
      });
    },
    isEditing: Boolean(edit),
    maxIndex: statefulAlbum.blocks.length,
  };

  const editTextBlockOptions: EditTextBlockOptions = {
    onEdit: (newBlock, newIndex) => {
      const newBlocks = [...statefulAlbum.blocks];
      const oldIndex = newBlocks.findIndex((b) => b.id === newBlock.id);
      newBlocks.splice(oldIndex, 1);
      newBlocks.splice(newIndex ?? oldIndex, 0, newBlock);

      setStatefulAlbum({
        ...statefulAlbum,
        blocks: newBlocks,
      });
    },
    onDelete: (oldIndex) => {
      const newBlocks = [...statefulAlbum.blocks];
      if (oldIndex != null) {
        newBlocks.splice(oldIndex, 1);
      }
      setStatefulAlbum({
        ...statefulAlbum,
        blocks: newBlocks,
      });
    },
    isEditing: Boolean(edit),
    maxIndex: statefulAlbum.blocks.length,
  };

  const blockControlOptions: BlockControlOptions = {
    isEditing: Boolean(edit),
    onEdit: (newBlock, newIndex) => {
      const newBlocks = [...statefulAlbum.blocks];
      newBlocks.splice(newIndex ?? 0, 0, newBlock as Block);

      setStatefulAlbum({
        ...statefulAlbum,
        blocks: newBlocks,
      });
    },
  };

  // SEO/Meta tag generation
  const title =
    statefulAlbum.title ?? statefulAlbum.name ?? statefulAlbum._build.slug;

  const imageCount = statefulAlbum.blocks.filter(
    (b) => b.kind === "photo",
  ).length;

  const cover =
    statefulAlbum.blocks.find(
      (b) => b.kind === "photo" && b.formatting?.cover,
    ) ?? statefulAlbum.blocks.find((b) => b.kind === "photo");

  return (
    <>
      <Head>
        <title>{title}</title>
        {album.kicker ? (
          <meta name="description" content={album.kicker} />
        ) : (
          <meta
            name="description"
            content={`${title} photo album: ${imageCount} photos`}
          />
        )}
        <link rel="icon" href="/favicon.svg" />
        <meta name="theme-color" content="#2c2c2c" />
        {cover ? (
          <meta
            property="og:image"
            content={(cover as PhotoBlock)._build.srcset?.[0].src}
          />
        ) : null}
      </Head>

      <Nav isEditing={Boolean(edit)} editable={Boolean(editable)} />
      {edit ? (
        <div className={styles.edit}>
          Edit mode
          <details>
            <summary>manifest.json</summary>
            <div className={styles.editDetails}>
              <pre>
                {JSON.stringify(serializeContentBlock(statefulAlbum), null, 2)}
              </pre>
            </div>
          </details>
          <details>
            <summary>Built manifest.json</summary>
            <div className={styles.editDetails}>
              <pre>{JSON.stringify(statefulAlbum, null, 2)}</pre>
            </div>
          </details>
        </div>
      ) : null}
      <PhotoAlbum
        album={statefulAlbum}
        editPhotoBlock={editPhotoBlockOptions}
        editTextBlock={editTextBlockOptions}
        blockControl={blockControlOptions}
      />
    </>
  );
};

export const getStaticProps: GetStaticProps<
  PageProps,
  { slug: string[] }
> = async (context) => {
  if (!context.params?.slug?.[0]) {
    return {
      props: {
        album: undefined,
        // Can't edit on edge workers
        editable: process.env.NODE_ENV !== "production",
      },
    };
  }

  if (context.params.slug[1] === "edit") {
    return {
      props: {
        album: await getAlbumFromName(context.params?.slug?.[0]),
        edit: true,
        editable: process.env.NODE_ENV !== "production",
      },
    };
  }

  return {
    props: {
      album: await getAlbumFromName(context.params?.slug?.[0]),
      edit: false,
      editable: process.env.NODE_ENV !== "production",
    },
  };
};

export const getStaticPaths: GetStaticPaths = async () => {
  // TODO: move into routes
  const paths = (await getAlbumNames()).map((n) => `/album/${n}`);
  console.log("Paths", paths);
  return {
    paths,
    fallback: true,
  };
};

export default Album;
