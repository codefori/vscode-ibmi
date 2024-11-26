import IBMi from "../api/IBMi";

export type CollectorGroup = CoverageCollector<any>[];
export interface CapturedMethods { [key: string]: number };

const IGNORE_METHODS = [`constructor`];

export class CoverageCollector<T> {
  private name: string = `Unknown`;
  private methodNames: string[] = [];
  private captured: CapturedMethods = {};
  constructor(private instanceClass: T, fixedName?: string) {
    if ('constructor' in (instanceClass as object)) {
      this.name = (instanceClass as object).constructor.name;
    }

    const isObject = this.name === `Object`;
    let methods = [];

    if (isObject) {
      // T is an object, so get a list of methods
      
      if (!fixedName) {
        throw new Error(`CoverageCollector: Object must have a fixed name`);
      }

      this.name = fixedName;
      methods = Object.keys(instanceClass as object);
      this.methodNames = methods.filter(prop => IGNORE_METHODS.includes(prop) === false && typeof instanceClass[prop as keyof T] === 'function');

    } else {
      // T is a class, so get a list of methods
      methods = Object.getOwnPropertyNames(Object.getPrototypeOf(instanceClass));

      this.methodNames = methods.filter(prop => IGNORE_METHODS.includes(prop) === false && typeof instanceClass[prop as keyof T] === 'function');
    }
    
    for (const func of this.methodNames) {
      this.captured[func] = 0;
    }

    this.wrap();
  }

  private wrap() {
    for (const method of this.methodNames) {
      const original = (this.instanceClass as any)[method];
      (this.instanceClass as any)[method] = (...args: any[]) => {
        this.captured[method]++;
        return original.apply(this.instanceClass, args);
      }
    }
  }

  getName() {
    return this.name;
  }

  reset() {
    for (const method of this.methodNames) {
      this.captured[method] = 0;
    }
  }

  getPercentCoverage() {
    const totalMethods = this.methodNames.length;
    const capturedMethods = Object.keys(this.captured).filter(method => this.captured[method] > 0).length;
    return Math.round((capturedMethods / totalMethods) * 100);
  }

  getCoverage() {
    return this.captured;
  }
}