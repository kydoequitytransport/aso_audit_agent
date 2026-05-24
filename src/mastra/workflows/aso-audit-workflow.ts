import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

const appListingSchema = z.object({
  trackId: z.number(),
  appUrl: z.string().url(),
  country: z.string(),
  trackName: z.string(),
  sellerName: z.string().optional().default('Unknown developer'),
  primaryGenreName: z.string().optional().default('Unknown category'),
  artworkUrl512: z.string().optional().default(''),
  averageUserRating: z.number().optional().nullable(),
  userRatingCount: z.number().optional().nullable(),
  description: z.string().optional().default(''),
  releaseNotes: z.string().optional().default(''),
  screenshotUrls: z.array(z.string()).optional().default([]),
  ipadScreenshotUrls: z.array(z.string()).optional().default([]),
  version: z.string().optional().default('Unknown'),
  currentVersionReleaseDate: z.string().optional().default('Unknown'),
  minimumOsVersion: z.string().optional().default('Unknown'),
});

const reviewSchema = z.object({
  title: z.string(),
  content: z.string(),
  author: z.string(),
  rating: z.number().min(1).max(5),
  updated: z.string(),
});

const competitorSchema = z.object({
  trackId: z.number(),
  trackName: z.string(),
  sellerName: z.string().optional().default('Unknown developer'),
  averageUserRating: z.number().optional().nullable(),
  userRatingCount: z.number().optional().nullable(),
  primaryGenreName: z.string().optional().default('Unknown category'),
});

const dimensionSchema = z.object({
  name: z.string(),
  weight: z.number(),
  score: z.number().min(0).max(10),
  weighted: z.number(),
  evidence: z.array(z.string()),
});

const firecrawlInsightsSchema = z.object({
  source: z.literal('firecrawl'),
  appStorePageTitle: z.string().optional(),
  markdownExcerpt: z.string(),
  screenshotCaptionHints: z.array(z.string()),
  videoMentions: z.number(),
  valuePropMentions: z.number(),
});

const auditOutputSchema = z.object({
  app: appListingSchema,
  scoreCard: z.object({
    dimensions: z.array(dimensionSchema),
    overallScore100: z.number(),
  }),
  reviewsSummary: z.object({
    totalFetched: z.number(),
    averageRecentRating: z.number(),
    praiseThemes: z.array(z.string()),
    complaintThemes: z.array(z.string()),
    sampleReviews: z.array(reviewSchema),
  }),
  competitors: z.array(competitorSchema),
  firecrawlInsights: firecrawlInsightsSchema.optional(),
  progressLog: z.array(z.string()),
});

const workflowInputSchema = z.object({
  appUrl: z.string().url(),
});

const parseUrl = (appUrl: string) => {
  const match = appUrl.match(/apps\.apple\.com\/([a-z]{2})\/app\/[^/]*\/id(\d+)/i);

  if (!match) {
    throw new Error('Invalid Apple App Store URL. Expected format: https://apps.apple.com/{country}/app/.../id123456789');
  }

  return {
    country: match[1].toLowerCase(),
    trackId: Number(match[2]),
  };
};

const fetchListing = async (trackId: number, country: string) => {
  const url = `https://itunes.apple.com/lookup?id=${trackId}&country=${country}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch app listing (${response.status})`);
  }

  const payload = (await response.json()) as {
    resultCount: number;
    results?: Array<Record<string, unknown>>;
  };

  if (!payload.resultCount || !payload.results?.[0]) {
    throw new Error('No app listing found for this URL.');
  }

  const raw = payload.results[0];

  return appListingSchema.parse({
    trackId,
    appUrl: `https://apps.apple.com/${country}/app/id${trackId}`,
    country,
    trackName: String(raw.trackName ?? 'Unknown app'),
    sellerName: String(raw.sellerName ?? 'Unknown developer'),
    primaryGenreName: String(raw.primaryGenreName ?? 'Unknown category'),
    artworkUrl512: String(raw.artworkUrl512 ?? ''),
    averageUserRating: Number(raw.averageUserRating ?? 0),
    userRatingCount: Number(raw.userRatingCount ?? 0),
    description: String(raw.description ?? ''),
    releaseNotes: String(raw.releaseNotes ?? ''),
    screenshotUrls: Array.isArray(raw.screenshotUrls) ? (raw.screenshotUrls as string[]) : [],
    ipadScreenshotUrls: Array.isArray(raw.ipadScreenshotUrls) ? (raw.ipadScreenshotUrls as string[]) : [],
    version: String(raw.version ?? 'Unknown'),
    currentVersionReleaseDate: String(raw.currentVersionReleaseDate ?? 'Unknown'),
    minimumOsVersion: String(raw.minimumOsVersion ?? 'Unknown'),
  });
};

const fetchRecentReviews = async (trackId: number, country: string) => {
  const url = `https://itunes.apple.com/${country}/rss/customerreviews/id=${trackId}/sortBy=mostRecent/json`;
  const response = await fetch(url);

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as {
    feed?: {
      entry?: Array<Record<string, unknown>>;
    };
  };

  const entries = payload.feed?.entry ?? [];

  return entries
    .slice(1, 15)
    .map((entry) => {
      const content = entry.content as { label?: string } | undefined;
      const title = entry.title as { label?: string } | undefined;
      const author = entry.author as { name?: { label?: string } } | undefined;
      const rating = entry['im:rating'] as { label?: string } | undefined;
      const updated = entry.updated as { label?: string } | undefined;

      const parsed = {
        title: title?.label ?? 'Untitled review',
        content: content?.label ?? '',
        author: author?.name?.label ?? 'Anonymous',
        rating: Number(rating?.label ?? 0),
        updated: updated?.label ?? 'Unknown date',
      };

      return reviewSchema.safeParse(parsed);
    })
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);
};

const fetchCompetitors = async (category: string, country: string, currentTrackId: number) => {
  const term = encodeURIComponent(category);
  const url = `https://itunes.apple.com/search?term=${term}&entity=software&country=${country}&limit=25`;
  const response = await fetch(url);

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as {
    results?: Array<Record<string, unknown>>;
  };

  return (payload.results ?? [])
    .filter((result) => Number(result.trackId) !== currentTrackId)
    .slice(0, 3)
    .map((result) =>
      competitorSchema.parse({
        trackId: Number(result.trackId ?? 0),
        trackName: String(result.trackName ?? 'Unknown competitor'),
        sellerName: String(result.sellerName ?? 'Unknown developer'),
        averageUserRating: Number(result.averageUserRating ?? 0),
        userRatingCount: Number(result.userRatingCount ?? 0),
        primaryGenreName: String(result.primaryGenreName ?? 'Unknown category'),
      }),
    );
};

const fetchFirecrawlInsights = async (appUrl: string) => {
  const apiKey = process.env.FIRECRAWL_API_KEY;

  if (!apiKey) {
    return undefined;
  }

  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: appUrl,
      formats: ['markdown'],
      onlyMainContent: true,
    }),
  });

  if (!response.ok) {
    return undefined;
  }

  const payload = (await response.json()) as {
    success?: boolean;
    data?: {
      markdown?: string;
      metadata?: {
        title?: string;
      };
    };
  };

  const markdown = payload.data?.markdown?.trim();

  if (!payload.success || !markdown) {
    return undefined;
  }

  const lines = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const screenshotCaptionHints = lines
    .filter((line) => /screenshot|screen shot|caption|feature|discover|listen|playlist|podcast/i.test(line))
    .slice(0, 6);

  const videoMentions = (markdown.match(/video|preview|watch/gi) ?? []).length;
  const valuePropMentions = (markdown.match(/free|personalized|discover|new releases|listen|download|offline/gi) ?? []).length;

  return firecrawlInsightsSchema.parse({
    source: 'firecrawl',
    appStorePageTitle: payload.data?.metadata?.title,
    markdownExcerpt: lines.slice(0, 12).join(' ').slice(0, 600),
    screenshotCaptionHints,
    videoMentions,
    valuePropMentions,
  });
};

const textLengthScore = (text: string, maxLength: number) => {
  const used = Math.min(text.length, maxLength);
  const ratio = used / maxLength;

  if (ratio >= 0.95) return 9;
  if (ratio >= 0.8) return 8;
  if (ratio >= 0.6) return 7;
  if (ratio >= 0.4) return 5;
  if (ratio >= 0.2) return 3;

  return 2;
};

const extractThemes = (reviews: Array<z.infer<typeof reviewSchema>>) => {
  const themes = [
    { key: 'easy', bucket: 'Ease of use' },
    { key: 'clean', bucket: 'Clean design' },
    { key: 'playlist', bucket: 'Playlist quality' },
    { key: 'bug', bucket: 'Bugs and stability' },
    { key: 'crash', bucket: 'Crashes' },
    { key: 'ads', bucket: 'Ads and interruptions' },
    { key: 'price', bucket: 'Pricing concerns' },
    { key: 'premium', bucket: 'Premium value' },
    { key: 'slow', bucket: 'Performance issues' },
    { key: 'recommend', bucket: 'Recommendation quality' },
  ];

  const counters = new Map<string, number>();

  for (const review of reviews) {
    const lower = `${review.title} ${review.content}`.toLowerCase();

    for (const theme of themes) {
      if (lower.includes(theme.key)) {
        counters.set(theme.bucket, (counters.get(theme.bucket) ?? 0) + 1);
      }
    }
  }

  return [...counters.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([bucket]) => bucket);
};

const scoreListing = (
  app: z.infer<typeof appListingSchema>,
  reviews: Array<z.infer<typeof reviewSchema>>,
  competitors: Array<z.infer<typeof competitorSchema>>,
  firecrawlInsights?: z.infer<typeof firecrawlInsightsSchema>,
) => {
  const titleLength = app.trackName.length;
  const subtitleCandidate = app.description.split('\n')[0]?.trim() ?? '';
  const subtitleLength = subtitleCandidate.length;

  const screenshotCount = app.screenshotUrls.length + app.ipadScreenshotUrls.length;
  const hasVideoHint = /video|preview/i.test(app.description) || (firecrawlInsights?.videoMentions ?? 0) > 0;
  const avgRating = Number(app.averageUserRating ?? 0);
  const ratingCount = Number(app.userRatingCount ?? 0);
  const recentAvg = reviews.length
    ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
    : 0;

  const topCompetitorRating = competitors.reduce((max, c) => Math.max(max, Number(c.averageUserRating ?? 0)), 0);

  const dimensions: Array<z.infer<typeof dimensionSchema>> = [
    {
      name: 'Title',
      weight: 0.2,
      score: Math.min(10, textLengthScore(app.trackName, 30) + (titleLength <= 30 ? 1 : -2)),
      weighted: 0,
      evidence: [`Title is "${app.trackName}" (${titleLength}/30 chars).`],
    },
    {
      name: 'Subtitle',
      weight: 0.15,
      score: Math.min(10, textLengthScore(subtitleCandidate, 30)),
      weighted: 0,
      evidence: [`Estimated subtitle candidate from first description line (${subtitleLength}/30 chars).`],
    },
    {
      name: 'Keyword field',
      weight: 0.15,
      score: 3,
      weighted: 0,
      evidence: ['Apple keyword field is not publicly exposed via iTunes API.'],
    },
    {
      name: 'Description',
      weight: 0.1,
      score: Math.min(
        10,
        textLengthScore(app.description, 120) + (app.description.includes('\n') ? 1 : 0) + ((firecrawlInsights?.valuePropMentions ?? 0) > 3 ? 1 : 0),
      ),
      weighted: 0,
      evidence: [`Description length is ${app.description.length} chars.`],
    },
    {
      name: 'Screenshots',
      weight: 0.15,
      score: Math.min(10, Math.round((screenshotCount / 10) * 10) + ((firecrawlInsights?.screenshotCaptionHints.length ?? 0) >= 3 ? 1 : 0)),
      weighted: 0,
      evidence: [`${screenshotCount} screenshot slots detected (target is 10).`],
    },
    {
      name: 'App preview video',
      weight: 0.05,
      score: hasVideoHint ? 6 : 2,
      weighted: 0,
      evidence: [hasVideoHint ? 'Description references a video/preview.' : 'No clear app preview signal found in public metadata.'],
    },
    {
      name: 'Ratings & reviews',
      weight: 0.15,
      score: Math.min(10, Math.round(((avgRating + recentAvg) / 10) * 10 + Math.min(2, ratingCount / 10000))),
      weighted: 0,
      evidence: [
        `Average rating: ${avgRating.toFixed(2)} from ${ratingCount.toLocaleString()} ratings.`,
        `Recent sample average: ${recentAvg.toFixed(2)} from ${reviews.length} fetched reviews.`,
      ],
    },
    {
      name: 'Icon',
      weight: 0.05,
      score: app.artworkUrl512 ? 7 : 2,
      weighted: 0,
      evidence: [app.artworkUrl512 ? '512px icon asset is present.' : 'No high-resolution icon URL found.'],
    },
    {
      name: 'Conversion signals',
      weight: 0.05,
      score: app.releaseNotes && app.releaseNotes.length > 40 ? 7 : 4,
      weighted: 0,
      evidence: [app.releaseNotes ? `What's New text present (${app.releaseNotes.length} chars).` : 'No release notes found in listing metadata.'],
    },
    {
      name: 'Competitive position',
      weight: 0.05,
      score: Math.max(1, Math.min(10, Math.round((avgRating - topCompetitorRating + 5) * 1.2))),
      weighted: 0,
      evidence: [
        `Top competitor rating in sample: ${topCompetitorRating.toFixed(2)}.`,
        `Current app rating: ${avgRating.toFixed(2)}.`,
      ],
    },
  ];

  for (const dimension of dimensions) {
    dimension.weighted = dimension.score * 10 * dimension.weight;
  }

  if (firecrawlInsights) {
    const screenshotDimension = dimensions.find((dimension) => dimension.name === 'Screenshots');
    const videoDimension = dimensions.find((dimension) => dimension.name === 'App preview video');
    const descriptionDimension = dimensions.find((dimension) => dimension.name === 'Description');

    if (screenshotDimension) {
      screenshotDimension.evidence.push(
        `Firecrawl extracted ${firecrawlInsights.screenshotCaptionHints.length} screenshot caption-like hints from page copy.`,
      );
    }

    if (videoDimension) {
      videoDimension.evidence.push(`Firecrawl found ${firecrawlInsights.videoMentions} video/preview keyword mentions on the page.`);
    }

    if (descriptionDimension) {
      descriptionDimension.evidence.push(`Firecrawl counted ${firecrawlInsights.valuePropMentions} value-proposition keyword mentions.`);
    }
  }

  const overallScore100 = Math.round(dimensions.reduce((sum, dimension) => sum + dimension.weighted, 0));

  const themes = extractThemes(reviews);

  return {
    scoreCard: {
      dimensions,
      overallScore100,
    },
    reviewsSummary: {
      totalFetched: reviews.length,
      averageRecentRating: Number(recentAvg.toFixed(2)),
      praiseThemes: themes.slice(0, 3),
      complaintThemes: themes.slice(3, 6),
      sampleReviews: reviews.slice(0, 5),
    },
  };
};

const fetchListingStep = createStep({
  id: 'fetch-listing-step',
  description: 'Fetch listing metadata from iTunes lookup endpoint.',
  inputSchema: workflowInputSchema,
  outputSchema: z.object({
    app: appListingSchema,
    progressLog: z.array(z.string()),
  }),
  execute: async ({ inputData }) => {
    if (!inputData) {
      throw new Error('Workflow input is missing.');
    }

    const { trackId, country } = parseUrl(inputData.appUrl);
    const app = await fetchListing(trackId, country);

    return {
      app,
      progressLog: ['Fetched app listing metadata from iTunes Lookup API.'],
    };
  },
});

const collectSignalsStep = createStep({
  id: 'collect-signals-step',
  description: 'Fetch reviews and competitor data for market context.',
  inputSchema: z.object({
    app: appListingSchema,
    progressLog: z.array(z.string()),
  }),
  outputSchema: z.object({
    app: appListingSchema,
    reviews: z.array(reviewSchema),
    competitors: z.array(competitorSchema),
    firecrawlInsights: firecrawlInsightsSchema.optional(),
    progressLog: z.array(z.string()),
  }),
  execute: async ({ inputData }) => {
    if (!inputData) {
      throw new Error('Intermediate workflow state is missing.');
    }

    const reviews = await fetchRecentReviews(inputData.app.trackId, inputData.app.country);
    const competitors = await fetchCompetitors(inputData.app.primaryGenreName, inputData.app.country, inputData.app.trackId);
    const firecrawlInsights = await fetchFirecrawlInsights(inputData.app.appUrl);

    const enrichmentMessage = firecrawlInsights
      ? 'Enriched listing signals with Firecrawl page scrape.'
      : process.env.FIRECRAWL_API_KEY
        ? 'Firecrawl key detected but enrichment was unavailable, continued with iTunes-only signals.'
        : 'No Firecrawl key detected, continued with iTunes-only signals.';

    return {
      app: inputData.app,
      reviews,
      competitors,
      firecrawlInsights,
      progressLog: [...inputData.progressLog, 'Collected review sentiment and competitor snapshots.', enrichmentMessage],
    };
  },
});

const computeAuditStep = createStep({
  id: 'compute-audit-step',
  description: 'Compute weighted score card and supporting evidence.',
  inputSchema: z.object({
    app: appListingSchema,
    reviews: z.array(reviewSchema),
    competitors: z.array(competitorSchema),
    firecrawlInsights: firecrawlInsightsSchema.optional(),
    progressLog: z.array(z.string()),
  }),
  outputSchema: auditOutputSchema,
  execute: async ({ inputData }) => {
    if (!inputData) {
      throw new Error('Intermediate workflow state is missing.');
    }

    const { scoreCard, reviewsSummary } = scoreListing(
      inputData.app,
      inputData.reviews,
      inputData.competitors,
      inputData.firecrawlInsights,
    );

    return {
      app: inputData.app,
      scoreCard,
      reviewsSummary,
      competitors: inputData.competitors,
      firecrawlInsights: inputData.firecrawlInsights,
      progressLog: [...inputData.progressLog, 'Computed weighted ASO score card and recommendation evidence.'],
    };
  },
});

export const asoAuditWorkflow = createWorkflow({
  id: 'aso-audit-workflow',
  inputSchema: workflowInputSchema,
  outputSchema: auditOutputSchema,
})
  .then(fetchListingStep)
  .then(collectSignalsStep)
  .then(computeAuditStep);

asoAuditWorkflow.commit();

export type AsoAuditOutput = z.infer<typeof auditOutputSchema>;
export { appListingSchema, reviewSchema, competitorSchema, firecrawlInsightsSchema, auditOutputSchema, parseUrl, fetchListing };
