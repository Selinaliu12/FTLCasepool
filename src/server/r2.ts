import "server-only";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";
import { isPdfMagic } from "@/domain/pdf";

function client() {
  const r2 = env.r2;
  // 本機測試把 R2_ENDPOINT 指到本機 Supabase Storage 的 S3 相容端點；正式環境沒有這個變數，
  // 退回真正的 R2 端點。自訂端點（本機測試、或未來換成別家 S3 相容服務）需要 path-style
  // addressing，否則 SDK 會把 bucket 名稱塞進 host（虛擬主機風格），本機端點解不出來。
  const endpoint = r2.endpoint ?? `https://${r2.accountId}.r2.cloudflarestorage.com`;
  return {
    s3: new S3Client({
      region: r2.region,
      endpoint,
      forcePathStyle: !!r2.endpoint,
      credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
    }),
    bucket: r2.bucket,
  };
}

export async function presignPdfPut(key: string, size: number): Promise<string> {
  const { s3, bucket } = client();
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: "application/pdf", ContentLength: size }),
    { expiresIn: 600, signableHeaders: new Set(["content-length", "content-type"]) }
  );
}

export async function inspectUploaded(key: string): Promise<{ size: number; isPdf: boolean } | null> {
  const { s3, bucket } = client();
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const part = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: "bytes=0-4" }));
    const bytes = new Uint8Array(await part.Body!.transformToByteArray());
    return { size: head.ContentLength ?? 0, isPdf: isPdfMagic(bytes) };
  } catch (e: unknown) {
    const err = e as { $metadata?: { httpStatusCode?: number }; name?: string };
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound" || err?.name === "NoSuchKey") {
      return null;
    }
    throw e;
  }
}

export async function presignPdfGet(key: string, downloadName: string): Promise<string> {
  const { s3, bucket } = client();
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${downloadName}"`,
    }),
    { expiresIn: 600 }
  );
}

export async function deleteObject(key: string): Promise<void> {
  const { s3, bucket } = client();
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
