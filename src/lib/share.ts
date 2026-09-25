import type { Metadata } from "next";
import { appName } from "@/lib/brand";
import { eventShareImage } from "@/lib/events";

/** What WhatsApp and iMessage show instead of the site-wide Stamp blurb. */
export function eventShareMetadata(
  event: { name: string; lumaEventId: string; coverUrl?: string | null },
  page: { title: string; description: string },
): Metadata {
  const image = eventShareImage(event);
  return {
    title: page.title,
    description: page.description,
    openGraph: {
      title: page.title,
      description: page.description,
      siteName: appName(),
      images: [{ url: image, alt: event.name }],
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
      images: [image],
    },
  };
}
