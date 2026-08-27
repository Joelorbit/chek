declare module 'pdf-parse' {
    interface PDFInfo {
        pdfInfo: {
            PDFFormatVersion: string;
            IsAcroFormPresent: boolean;
            IsXFAPresent: boolean;
            Title: string;
            Author: string;
            Creator: string;
            Producer: string;
            CreationDate: string;
            ModDate: string;
            Tagged: boolean;
            Form: string;
            Pages: number;
        };
        metadata?: any;
        text: string;
        numrender: number;
        version: string;
    }

    interface Options {
        pagerender?: (pageData: any) => string;
        max?: number;
        version?: string;
    }

    function pdf(dataBuffer: Buffer, options?: Options): Promise<PDFInfo>;

    export = pdf;
}
