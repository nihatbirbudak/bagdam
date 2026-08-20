/**
 * `hbs` (Express Handlebars view engine) paketi tip dosyası yayımlamaz.
 * F1'de kullanılan yüzey için asgari ortam bildirimi — @types/hbs EKLENMEZ
 * (çakışma olmasın). Daha fazla API gerekirse buraya eklenir.
 */
declare module 'hbs' {
  interface HbsPartialOptions {
    /** Dosya adından partial adına dönüşüm (varsayılan: boşluk/tire → alt çizgi). */
    rename?: (name: string) => string;
  }

  interface HbsInstance {
    /** Dizindeki tüm .hbs/.html dosyalarını partial olarak kaydeder (async; done ile bildirir). */
    registerPartials(directory: string, done?: (err?: Error) => void): void;
    registerPartials(directory: string, options: HbsPartialOptions, done?: (err?: Error) => void): void;
    registerPartial(name: string, partial: string | ((context: unknown) => string)): void;
    registerHelper(name: string, fn: (...args: any[]) => unknown): void;
    /** Express `app.locals` değerlerini şablon verisi olarak kullanılabilir yapar. */
    localsAsTemplateData(app: unknown): void;
    /** Altta yatan Handlebars örneği */
    handlebars: any;
    /** Express view engine callback'i (app.engine('hbs', hbs.__express)) */
    __express(
      filePath: string,
      options: Record<string, unknown>,
      callback: (err: Error | null, html?: string) => void,
    ): void;
    /** Yeni, izole bir örnek oluşturur */
    create(): HbsInstance;
  }

  const hbs: HbsInstance;
  export = hbs;
}
