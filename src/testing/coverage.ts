import IBMi from "../api/IBMi";

export class CoverageCollector<T> {
  private methodNames: string[];
  private captured: { [key: string]: number } = {};
  constructor(private instanceClass: T) {
    // T is a class, so get a list of methods
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(instanceClass));

    this.methodNames = methods.filter(prop => typeof instanceClass[prop as keyof T] === 'function');
    
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
}