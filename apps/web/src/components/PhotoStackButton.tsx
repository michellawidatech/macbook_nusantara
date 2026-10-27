/**
 * A row's photos as a thumbnail rather than a camera and a number (owner ask
 * 2026-10-21: "display image preview instead of just image icon … it will
 * look stacked if there are multiple image but only show 2 stack").
 *
 * The first photo is drawn; when there are more, ONE card sits offset behind
 * it — never more than two layers, however many photos there are — and the
 * count stays beside it. With no photo yet it is the camera button it always
 * was, because the button is also how the first photo gets added.
 */
import type { ReactNode } from "react";
import { Button, theme } from "antd";
import { CameraOutlined } from "@ant-design/icons";

export interface PhotoStackButtonProps {
  readonly urls: readonly string[];
  readonly ariaLabel: string;
  readonly onClick: () => void;
  /** Thumbnail side in px. */
  readonly size?: number;
}

export function PhotoStackButton({
  urls,
  ariaLabel,
  onClick,
  size = 26,
}: PhotoStackButtonProps): ReactNode {
  const {
    token: {
      colorBorder,
      colorBgContainer,
      colorTextSecondary,
      borderRadiusSM,
    },
  } = theme.useToken();

  if (urls.length === 0) {
    return (
      <Button
        size="small"
        type="text"
        icon={<CameraOutlined aria-hidden />}
        aria-label={ariaLabel}
        onClick={onClick}
      />
    );
  }

  const card = {
    position: "absolute" as const,
    width: size,
    height: size,
    borderRadius: borderRadiusSM,
    border: `1px solid ${colorBorder}`,
    background: colorBgContainer,
    objectFit: "cover" as const,
    display: "block",
  };
  const stacked = urls.length > 1;
  const offset = stacked ? 3 : 0;

  return (
    <Button
      size="small"
      type="text"
      aria-label={ariaLabel}
      onClick={onClick}
      style={{ paddingInline: 4, height: size + offset + 4 }}
      data-testid="photo-stack"
    >
      <span
        style={{
          position: "relative",
          display: "inline-block",
          width: size + offset,
          height: size + offset,
        }}
      >
        {stacked && (
          // The second photo, peeking out behind the first.
          <img
            src={urls[1]}
            alt=""
            aria-hidden
            style={{ ...card, left: offset, top: 0, opacity: 0.85 }}
          />
        )}
        <img src={urls[0]} alt="" style={{ ...card, left: 0, top: offset }} />
      </span>
      {stacked && (
        <span style={{ color: colorTextSecondary, marginLeft: 2 }}>
          {urls.length}
        </span>
      )}
    </Button>
  );
}
