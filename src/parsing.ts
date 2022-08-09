import {
  ICover,
  IFooter,
  IHeader,
  IKeyword,
  ILayer,
  ILayerInfo,
  ILayerNames,
  IPage,
  ISupernote,
  ITitle,
} from "~/format"

/** Get content at location. */
export function getContentAtAddress(
  buffer: Buffer,
  address: number,
  byteLength: number
): Buffer | null {
  if (address === 0) return null
  const blockLength = buffer.readUintLE(address, byteLength)
  const content = buffer.subarray(address + byteLength, address + byteLength + blockLength)
  return content
}

/** Parse key-value pairs. */
export function parseKeyValue(
  buffer: Buffer,
  address: number,
  byteLength: number
): Record<string, string | string[]> {
  const content = getContentAtAddress(buffer, address, byteLength)
  if (content === null) return {}
  return extractKeyValue(content.toString())
}

/** Extract key-value pairs from content. */
export function extractKeyValue(content: string): Record<string, string | string[]> {
  const pattern = /<([^:<>]+):([^:<>]+)>/gm
  const pairs = [...content.matchAll(pattern)]
  const data = pairs.reduce((acc: Record<string, string | string[]>, [_, key, value]) => {
    if (key in acc) {
      let newValue =
        typeof acc[key] === "string" ? [acc[key] as string, value] : [...acc[key], value]
      acc[key] = newValue
    } else {
      acc[key] = value
    }
    return acc
  }, {})
  return data
}

/** Extract nested key-values from a record. */
export function extractNestedKeyValue(
  record: Record<string, string | string[]>,
  delimiter = "_",
  prefixes: string[] = []
): Record<string, Record<string, string>> {
  const data: Record<string, Record<string, string>> = {}
  Object.entries(record).forEach(([key, value]) => {
    let main: string | undefined
    let sub: string | undefined
    if (typeof value !== "string") return

    // With regular delimiter.
    const idx = key.indexOf(delimiter)
    if (idx > -1) {
      main = key.substring(0, idx)
      sub = key.substring(idx + 1)
    } else {
      // Check numbered keys instead.
      for (const prefix of prefixes) {
        if (!key.startsWith(prefix)) continue
        main = prefix
        sub = key.substring(main.length)
        break
      }
    }
    // Set nested keys if both main and sub found.
    if (!(main && sub)) return
    if (main in data) data[main][sub] = value
    else data[main] = { [sub]: value }
  })
  return data
}

/** Extract layer info from the content string. */
export function extractLayerInfo(content: string): ILayerInfo[] {
  const layerPattern = /{(?<content>[^{}]+)}/gm
  const dictPattern = /"(?<key>[^"\[{}\]]+)"#"?(?<value>[^"\[{}\],]+)/gm
  // Fetch the string per layer from the array (between {}'s).
  const layerContents = Array.from(content.matchAll(layerPattern))
  const layerInfos = layerContents.map((match) => {
    if (match.groups === undefined) throw new Error("Undefined layer content.")
    // Fetch every key value pair for each layer.
    const layerDictContents = Array.from(match.groups.content.matchAll(dictPattern))
    const data = layerDictContents.reduce((acc: Record<string, string>, match) => {
      if (match.groups === undefined) throw new Error("Undefined key/value pair.")
      const { key, value } = match.groups
      acc[key] = value
      return acc
    }, {})

    // Morph this into a layer info object.
    const layerInfo: ILayerInfo = {
      layerId: parseInt(data.layerId ?? "0"),
      name: data.name ?? "Main layer",
      isBackgroundLayer: data.isBackgroundLayer === "true",
      isAllowAdd: data.isAllowAdd === "true",
      isCurrentLayer: data.isCurrentLayer === "true",
      isVisible: data.isVisible === "true",
      isDeleted: data.isDeleted === "true",
      isAllowUp: data.isAllowUp === "true",
      isAllowDown: data.isAllowDown === "true",
    }
    return layerInfo
  })
  return layerInfos
}

/** Supernote X series note. */
export interface SupernoteX extends ISupernote {}
export class SupernoteX {
  constructor(buffer: Buffer) {
    this.pageWidth = 1404
    this.pageHeight = 1872
    this.addressSize = 4
    this.lengthFieldSize = 4
    this.defaultLayers = ["MAINLAYER", "LAYER1", "LAYER2", "LAYER3", "BGLAYER"]
    this._parseBuffer(buffer)
  }

  /** Parse note contents from buffer. */
  _parseBuffer(buffer: Buffer): Partial<SupernoteX> {
    this._parseSignature(buffer)
    this._parseFooter(buffer)
    this._parseHeader(buffer)
    this._parsePages(buffer)
    this._parseCover(buffer)
    this._parseKeywords(buffer)
    this._parseTitles(buffer)
    return this
  }

  /** Parse Supernote file signature from buffer. */
  _parseSignature(buffer: Buffer): string {
    const pattern = /^noteSN_FILE_VER_\d{8}/
    const content = buffer.toString(undefined, 0, 24)
    const isMatch = pattern.test(content)
    if (!isMatch) throw new Error("Cannot parse this file. Signature doesn't match.")
    this.signature = content
    return this.signature
  }

  /** Parse the footer of a Supernote file's buffer contents. */
  _parseFooter(buffer: Buffer): IFooter {
    const chunk = buffer.subarray(buffer.length - this.addressSize)
    const address = chunk.readUIntLE(0, this.addressSize)
    const data = parseKeyValue(buffer, address, this.lengthFieldSize)
    const nested = extractNestedKeyValue(data, "_", ["PAGE"])
    this.footer = {
      FILE: { FEATURE: "24" },
      COVER: { "0": "0" },
      KEYWORD: {},
      TITLE: {},
      STYLE: {},
      PAGE: {},
      ...nested,
    }
    return this.footer
  }

  /** Parse the header of a Supernote file's buffer contents.
   * Relies on the address as given in the file's footer. */
  _parseHeader(buffer: Buffer): IHeader {
    const address = this.footer.FILE?.FEATURE ? parseInt(this.footer.FILE.FEATURE) : 24
    const data = parseKeyValue(buffer, address, this.lengthFieldSize)
    this.header = {
      MODULE_LABEL: "0",
      FILE_TYPE: "0",
      APPLY_EQUIPMENT: "0",
      FINAL_OPERATION_PAGE: "0",
      FINAL_OPERATION_LAYER: "0",
      ORIGINAL_STYLE: "0",
      ORIGINAL_STYLEMD5: "0",
      DEVICE_DPI: "0",
      SOFT_DPI: "0",
      FILE_PARSE_TYPE: "0",
      RATTA_ETMD: "0",
      APP_VERSION: "0",
      ...data,
    }
    return this.header
  }

  /** Parse pages of a Supernote file's buffer contents.
   * Relies on the address as given in the file's footer. */
  _parsePages(buffer: Buffer) {
    const pages: IPage[] = Array.from(Object.keys(this.footer.PAGE))
      .sort()
      .map((idx) => {
        const address = parseInt(this.footer.PAGE[idx])
        const data = parseKeyValue(buffer, address, this.lengthFieldSize)
        return {
          PAGESTYLE: "0",
          PAGESTYLEMD5: "0",
          LAYERSWITCH: "0",
          TOTALPATH: "0",
          THUMBNAILTYPE: "0",
          ...data,
          MAINLAYER: this._parseLayer(buffer, parseInt((data.MAINLAYER as string) ?? "0")),
          LAYER1: this._parseLayer(buffer, parseInt((data.LAYER1 as string) ?? "0")),
          LAYER2: this._parseLayer(buffer, parseInt((data.LAYER2 as string) ?? "0")),
          LAYER3: this._parseLayer(buffer, parseInt((data.LAYER3 as string) ?? "0")),
          BGLAYER: this._parseLayer(buffer, parseInt((data.BGLAYER as string) ?? "0")),
          LAYERINFO: extractLayerInfo(data["LAYERINFO"] as string),
          LAYERSEQ: (data["LAYERSEQ"] as string).split(",") as ILayerNames[],
          totalPathBuffer: getContentAtAddress(
            buffer,
            parseInt((data.TOTALPATH as string) ?? "0"),
            this.lengthFieldSize
          ),
        }
      })
    this.pages = pages
    return pages
  }

  /** Parse layer at a specific address in a Supernote file's buffer contents. */
  _parseLayer(buffer: Buffer, address: number): ILayer {
    const data = parseKeyValue(buffer, address, this.lengthFieldSize)
    const bitmapBuffer = getContentAtAddress(
      buffer,
      parseInt((data.LAYERBITMAP as string) ?? "0"),
      this.lengthFieldSize
    )
    return {
      LAYERTYPE: "NOTE",
      LAYERPROTOCOL: "RATTA_RLE",
      LAYERNAME: "MAINLAYER",
      LAYERPATH: "0",
      LAYERBITMAP: "0",
      LAYERVECTORGRAPH: "0",
      LAYERRECOGN: "0",
      ...data,
      bitmapBuffer,
    }
  }

  /** Parse cover from Supernote file's buffer contents. */
  _parseCover(buffer: Buffer): ICover | undefined {
    const address = parseInt(this.footer.COVER["0"] ?? this.footer.COVER["1"])
    if (address && address > 0) {
      const bitmapBuffer = getContentAtAddress(buffer, address, this.lengthFieldSize)
      this.cover = { bitmapBuffer }
    }
    return this.cover
  }

  /** Parse keywords from Supernote file's buffer contents. */
  _parseKeywords(buffer: Buffer): Record<string, IKeyword[]> {
    this.keywords = {}
    Object.entries(this.footer.KEYWORD).forEach(([key, value]) => {
      if (!(key in this.keywords)) this.keywords[key] = []
      if (typeof value === "string")
        this.keywords[key].push(this._parseKeyword(buffer, parseInt(value)))
      else
        value.forEach((address) =>
          this.keywords[key].push(this._parseKeyword(buffer, parseInt(address)))
        )
    })
    return this.keywords
  }

  /** Parse a single keyword entry at a certain buffer address. */
  _parseKeyword(buffer: Buffer, address: number): IKeyword {
    const data = parseKeyValue(buffer, address, this.lengthFieldSize)
    const bitmapBuffer = getContentAtAddress(
      buffer,
      parseInt((data.KEYWORDSITE as string) ?? "0"),
      this.lengthFieldSize
    )
    const keyword: IKeyword = {
      KEYWORDSEQNO: "0",
      KEYWORDPAGE: "1",
      KEYWORDRECT: ["0", "0", "0", "0"],
      KEYWORDRECTORI: ["0", "0", "0", "0"],
      KEYWORDSITE: "0",
      KEYWORDLEN: "0",
      KEYWORD: "",
      bitmapBuffer,
    }
    return keyword
  }

  /** Parse titles from Supernote file's buffer contents. */
  _parseTitles(buffer: Buffer): Record<string, ITitle[]> {
    this.titles = {}
    Object.entries(this.footer.TITLE).forEach(([key, value]) => {
      if (!(key in this.titles)) this.titles[key] = []
      if (typeof value === "string")
        this.titles[key].push(this._parseTitle(buffer, parseInt(value)))
      else
        value.forEach((address) =>
          this.titles[key].push(this._parseTitle(buffer, parseInt(address)))
        )
    })
    return this.titles
  }

  /** Parse a single title entry at a certain buffer address. */
  _parseTitle(buffer: Buffer, address: number): ITitle {
    const data = parseKeyValue(buffer, address, this.lengthFieldSize)
    const bitmapBuffer = getContentAtAddress(
      buffer,
      parseInt((data.TITLEBITMAP as string) ?? "0"),
      this.lengthFieldSize
    )
    const title: ITitle = {
      TITLESEQNO: "0",
      TITLELEVEL: "1",
      TITLERECT: ["0", "0", "0", "0"],
      TITLERECTORI: ["0", "0", "0", "0"],
      TITLEBITMAP: "0",
      TITLEPROTOCOL: "RATTA_RLE",
      TITLESTYLE: "1000254",
      ...data,
      bitmapBuffer,
    }
    return title
  }
}
